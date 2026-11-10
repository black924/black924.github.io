// One-time AdMob connection: /admobOauthStart → Google consent → /admobOauthCallback.
// The callback only accepts a Google account that is on config/app.allowedEmails.
import { randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { db } from '../shared/firestore';
import { REGION } from '../shared/region';
import { ADMOB_REFRESH_TOKEN, writeSecret } from '../shared/secrets';
import { runAdmobSync } from './sync';

export const ADMOB_SCOPE = 'https://www.googleapis.com/auth/admob.readonly';
const STATE_TTL_MS = 10 * 60_000;

/** Must match the redirect URI registered on the OAuth client exactly. */
export function callbackUrl(): string {
  const project = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  return `https://${REGION}-${project}.cloudfunctions.net/admobOauthCallback`;
}

/** Accepts ?login_hint=<email> from the dashboard so Google preselects the signed-in dashboard account. */
export function loginHint(v: unknown): string | undefined {
  return typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : undefined;
}

export async function handleStart(req: Request, res: Response, clientId: string) {
  const state = randomBytes(24).toString('base64url');
  await db.doc(`oauthStates/${state}`).set({ createdAt: Timestamp.now() });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: `openid email ${ADMOB_SCOPE}`,
    access_type: 'offline',
    // select_account: always show the account chooser instead of using the browser's default account.
    // consent: always return a refresh token.
    prompt: 'select_account consent',
    state,
  });
  const hint = loginHint(req.query.login_hint);
  if (hint) params.set('login_hint', hint);
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

function page(res: Response, status: number, title: string, body: string) {
  res
    .status(status)
    .set('Content-Type', 'text/html; charset=utf-8')
    .send(
      `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07080B;color:#ECEFF4;` +
        `font-family:system-ui,sans-serif;padding:16px}main{max-width:420px;background:#0F1218;border:1px solid #1E232D;border-radius:20px;padding:28px}` +
        `h1{font-size:20px;margin:0 0 8px}p{color:#A8B0BE;line-height:1.6;margin:0}</style></head>` +
        `<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`,
    );
}

/** Reads the id_token payload. It came straight from Google's token endpoint over TLS, so its signature check is not required (OIDC Core 3.1.3.7). */
function idTokenClaims(idToken: string): Record<string, unknown> {
  const payload = idToken.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

export async function handleCallback(req: Request, res: Response, clientId: string, clientSecret: string) {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error) return page(res, 400, '연결이 취소되었습니다', 'Google 동의 화면에서 취소했거나 오류가 발생했습니다. 다시 시도해 주세요.');
  if (!code || !state) return page(res, 400, '잘못된 요청입니다', '연결 버튼으로 다시 시작해 주세요.');

  const stateRef = db.doc(`oauthStates/${state}`);
  const stateDoc = await stateRef.get();
  await stateRef.delete().catch(() => undefined);
  const created = stateDoc.get('createdAt') as Timestamp | undefined;
  if (!created || Date.now() - created.toMillis() > STATE_TTL_MS) {
    return page(res, 400, '연결 요청이 만료되었습니다', '연결 버튼으로 다시 시작해 주세요.');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: callbackUrl(), grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(15_000),
  });
  const tokens = (await tokenRes.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; scope?: string; error?: string };
  if (!tokenRes.ok || !tokens.id_token) {
    logger.error('admob oauth: token exchange failed', { status: tokenRes.status, error: tokens.error });
    return page(res, 502, '연결에 실패했습니다', 'Google에서 토큰을 받지 못했습니다. 다시 시도해 주세요.');
  }

  const claims = idTokenClaims(tokens.id_token);
  const email = String(claims.email ?? '').toLowerCase();
  const allowed = ((await db.doc('config/app').get()).get('allowedEmails') as string[] | undefined) ?? [];
  if (claims.aud !== clientId || claims.email_verified !== true || !allowed.includes(email)) {
    logger.warn('admob oauth: account not allowed');
    return page(res, 403, '허용되지 않은 계정입니다', '대시보드 allowlist에 있는 Google 계정으로 연결해 주세요.');
  }
  if (!tokens.scope?.split(' ').includes(ADMOB_SCOPE)) {
    return page(res, 400, 'AdMob 권한이 필요합니다', '동의 화면에서 AdMob 리포트 보기 권한을 허용해 주세요.');
  }
  if (!tokens.refresh_token) {
    return page(res, 502, '연결에 실패했습니다', 'Google이 장기 토큰을 주지 않았습니다. 다시 시도해 주세요.');
  }

  await writeSecret(ADMOB_REFRESH_TOKEN, tokens.refresh_token);
  logger.info('admob oauth: connected');
  await runAdmobSync({ clientId, clientSecret, refreshToken: tokens.refresh_token, full: true });
  return page(res, 200, 'AdMob 연결 완료', '첫 동기화를 마쳤습니다. 이 창을 닫고 대시보드로 돌아가세요. 이후 30분마다 자동으로 갱신됩니다.');
}
