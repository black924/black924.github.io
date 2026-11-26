// Callable used by the open Analytics screen about once a minute. The browser never calls GA4 itself
// (CLAUDE.md §1): this re-checks the allowlist, then refreshes realtime/now (≥ 50 s apart) and
// analytics/daily (≥ 30 min apart).
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../shared/firestore';
import { isAllowedCaller } from '../requestSync';
import { AnalyticsError, analyticsErrorMessage, streamApps } from './ga4';
import { syncRealtime } from './realtime';
import { syncAnalyticsDaily } from './daily';

export const REALTIME_MIN_INTERVAL_MS = 50_000;
export const DAILY_MIN_INTERVAL_MS = 30 * 60_000;

export type AnalyticsResult = { status: 'synced' | 'recent' | 'disabled' | 'failed'; message?: string };

const age = async (path: string) => {
  const at = (await db.doc(path).get()).get('updatedAt') as Timestamp | undefined;
  return at ? Date.now() - at.toMillis() : Infinity;
};

async function guarded(path: string, run: () => Promise<void>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    const message = analyticsErrorMessage(e);
    logger.error('ga4 sync failed', { path, status: e instanceof AnalyticsError ? e.status : undefined });
    await db.doc(path).set({ state: 'error', error: message, updatedAt: Timestamp.now() }, { merge: true });
    return message;
  }
}

export async function handleRequestAnalytics(req: CallableRequest): Promise<AnalyticsResult> {
  if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const config = await db.doc('config/app').get();
  const allowed = (config.get('allowedEmails') as string[] | undefined) ?? [];
  if (!isAllowedCaller(req.auth.token, allowed)) throw new HttpsError('permission-denied', '권한이 없는 계정입니다.');

  const propertyId = config.get('ga4PropertyId');
  if (typeof propertyId !== 'string' || !/^\d+$/.test(propertyId)) return { status: 'disabled' };

  const [rtAge, dailyAge] = await Promise.all([age('realtime/now'), age('analytics/daily')]);
  const doRealtime = rtAge >= REALTIME_MIN_INTERVAL_MS;
  const doDaily = dailyAge >= DAILY_MIN_INTERVAL_MS;
  if (!doRealtime && !doDaily) return { status: 'recent' };

  let streams;
  try {
    streams = await streamApps(propertyId);
  } catch (e) {
    const message = analyticsErrorMessage(e);
    logger.error('ga4 streams failed', { status: e instanceof AnalyticsError ? e.status : undefined });
    await db.doc('realtime/now').set({ state: 'error', error: message, updatedAt: Timestamp.now() }, { merge: true });
    return { status: 'failed', message };
  }
  const errors = await Promise.all([
    doRealtime ? guarded('realtime/now', () => syncRealtime(propertyId, streams)) : null,
    doDaily ? guarded('analytics/daily', () => syncAnalyticsDaily(propertyId, streams)) : null,
  ]);
  const message = errors.find((m) => m);
  return message ? { status: 'failed', message } : { status: 'synced' };
}
