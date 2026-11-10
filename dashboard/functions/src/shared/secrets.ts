// Secret Manager access at runtime (REST), for values that change without a redeploy.
// defineSecret() values are bound at cold start and need a redeploy to change (Firebase docs),
// so the AdMob refresh token, which the OAuth callback rewrites, is read here instead.
import { applicationDefault } from 'firebase-admin/app';
import { defineSecret } from 'firebase-functions/params';

export const ADMOB_OAUTH_CLIENT_ID = defineSecret('ADMOB_OAUTH_CLIENT_ID');
export const ADMOB_OAUTH_CLIENT_SECRET = defineSecret('ADMOB_OAUTH_CLIENT_SECRET');
export const ADMOB_REFRESH_TOKEN = 'ADMOB_REFRESH_TOKEN'; // runtime-managed

const BASE = 'https://secretmanager.googleapis.com/v1';

function projectId(): string {
  const id = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (!id) throw new Error('Project id not available');
  return id;
}

async function call(path: string, init: RequestInit = {}) {
  const { access_token } = await applicationDefault().getAccessToken();
  const res = await fetch(`${BASE}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(15_000),
  });
  return res;
}

/** Latest enabled version, or null when the secret has no versions yet. */
export async function readSecret(name: string): Promise<string | null> {
  const res = await call(`projects/${projectId()}/secrets/${name}/versions/latest:access`);
  if (res.status === 404 || res.status === 400) return null; // no (enabled) version
  if (!res.ok) throw new Error(`Secret read failed (${res.status})`);
  const body = (await res.json()) as { payload?: { data?: string } };
  return body.payload?.data ? Buffer.from(body.payload.data, 'base64').toString('utf8') : null;
}

/** Adds a new version and disables older enabled ones (keeps the free tier's active-version count low). */
export async function writeSecret(name: string, value: string): Promise<void> {
  const secret = `projects/${projectId()}/secrets/${name}`;
  const res = await call(`${secret}:addVersion`, {
    method: 'POST',
    body: JSON.stringify({ payload: { data: Buffer.from(value, 'utf8').toString('base64') } }),
  });
  if (!res.ok) throw new Error(`Secret write failed (${res.status})`);
  const added = (await res.json()) as { name: string };

  const list = await call(`${secret}/versions?filter=state:ENABLED`);
  if (!list.ok) return;
  const { versions = [] } = (await list.json()) as { versions?: { name: string }[] };
  for (const v of versions) {
    if (v.name !== added.name) await call(`${v.name}:disable`, { method: 'POST', body: '{}' });
  }
}
