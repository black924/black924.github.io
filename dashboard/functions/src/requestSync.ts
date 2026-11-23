// Manual refresh from the dashboard header. The browser never calls external APIs (CLAUDE.md §1),
// so it asks this function, which re-checks the allowlist server-side and runs the AdMob sync.
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { Timestamp } from 'firebase-admin/firestore';
import { runAdmobSync } from './admob/sync';
import { db } from './shared/firestore';

export const MIN_INTERVAL_MS = 60_000;

export type SyncResult = { status: 'synced' | 'recent' | 'failed'; lastRunAt: string | null; message?: string };

/** Pure check, unit-tested: may this caller trigger a sync? */
export function isAllowedCaller(token: { email?: string; email_verified?: boolean } | undefined, allowed: string[]): boolean {
  const email = token?.email?.toLowerCase();
  return Boolean(email && token?.email_verified === true && allowed.includes(email));
}

export async function handleRequestSync(req: CallableRequest, creds: { clientId: string; clientSecret: string }): Promise<SyncResult> {
  if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const allowed = ((await db.doc('config/app').get()).get('allowedEmails') as string[] | undefined) ?? [];
  if (!isAllowedCaller(req.auth.token, allowed)) throw new HttpsError('permission-denied', '권한이 없는 계정입니다.');

  const ref = db.doc('sync/admob');
  const last = (await ref.get()).get('lastRunAt') as Timestamp | undefined;
  if (last && Date.now() - last.toMillis() < MIN_INTERVAL_MS) {
    return { status: 'recent', lastRunAt: last.toDate().toISOString(), message: '방금 갱신했습니다.' };
  }

  await runAdmobSync(creds); // records ok/error in sync/admob itself
  const after = await ref.get();
  const at = (after.get('lastRunAt') as Timestamp | undefined)?.toDate().toISOString() ?? null;
  return after.get('state') === 'ok'
    ? { status: 'synced', lastRunAt: at }
    : { status: 'failed', lastRunAt: at, message: (after.get('lastError') as string | undefined) ?? '동기화에 실패했습니다.' };
}
