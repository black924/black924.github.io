// Callable used by the open Analytics screen about once a minute. The browser never calls GA4 itself
// (CLAUDE.md §1): this re-checks the allowlist, then refreshes realtime/now (≥ 50 s apart) and
// analytics/daily (≥ 30 min apart) from every configured GA4 property (one per Firebase project).
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { Timestamp } from 'firebase-admin/firestore';
import { db } from '../shared/firestore';
import { isAllowedCaller } from '../requestSync';
import { AnalyticsError, analyticsErrorMessage, propertyIds, streamApps } from './ga4';
import { fetchRealtime, writeRealtime } from './realtime';
import { fetchDaily, writeDaily } from './daily';

export const REALTIME_MIN_INTERVAL_MS = 50_000;
export const DAILY_MIN_INTERVAL_MS = 30 * 60_000;

export type AnalyticsResult = { status: 'synced' | 'recent' | 'disabled' | 'failed'; message?: string };

const age = async (path: string) => {
  const at = (await db.doc(path).get()).get('updatedAt') as Timestamp | undefined;
  return at ? Date.now() - at.toMillis() : Infinity;
};

/** Runs `fn` for each property; failures are logged and turned into one dashboard message. */
async function perProperty<I extends { id: string }, T>(items: I[], what: string, fn: (item: I) => Promise<T>): Promise<{ ok: T[]; error: string | null }> {
  const ids = items.map((x) => x.id);
  const results = await Promise.allSettled(items.map(fn));
  const ok: T[] = [];
  const failed: { id: string; e: unknown }[] = [];
  results.forEach((r, i) => (r.status === 'fulfilled' ? ok.push(r.value) : failed.push({ id: ids[i], e: r.reason })));
  for (const f of failed) {
    logger.error('ga4 sync failed', { what, propertyId: f.id, status: f.e instanceof AnalyticsError ? f.e.status : undefined });
  }
  if (!failed.length) return { ok, error: null };
  const msg = analyticsErrorMessage(failed[0].e);
  return { ok, error: ids.length > 1 ? `속성 ${failed.map((f) => f.id).join(', ')}: ${msg}` : msg };
}

export async function handleRequestAnalytics(req: CallableRequest): Promise<AnalyticsResult> {
  if (!req.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const config = await db.doc('config/app').get();
  const allowed = (config.get('allowedEmails') as string[] | undefined) ?? [];
  if (!isAllowedCaller(req.auth.token, allowed)) throw new HttpsError('permission-denied', '권한이 없는 계정입니다.');

  const ids = propertyIds({ ga4PropertyIds: config.get('ga4PropertyIds'), ga4PropertyId: config.get('ga4PropertyId') });
  if (!ids.length) return { status: 'disabled' };

  const [rtAge, dailyAge] = await Promise.all([age('realtime/now'), age('analytics/daily')]);
  const doRealtime = rtAge >= REALTIME_MIN_INTERVAL_MS;
  const doDaily = dailyAge >= DAILY_MIN_INTERVAL_MS;
  if (!doRealtime && !doDaily) return { status: 'recent' };

  const streams = await perProperty(ids.map((id) => ({ id })), 'streams', async ({ id }) => ({ id, ...(await streamApps(id)) }));
  const errors: (string | null)[] = [streams.error];
  if (doRealtime) {
    const r = await perProperty(streams.ok, 'realtime', (p) => fetchRealtime(p.id, p.map));
    await writeRealtime(r.ok, streams.error ?? r.error);
    errors.push(r.error);
  }
  if (doDaily) {
    const d = await perProperty(streams.ok, 'daily', (p) => fetchDaily(p.id, p.map));
    const streamList = streams.ok.flatMap((p) => p.streams.map((s) => ({ propertyId: p.id, ...s, appId: p.map.get(s.id)?.appId ?? null })));
    await writeDaily(d.ok, streamList, streams.error ?? d.error);
    errors.push(d.error);
  }
  const message = errors.find((m) => m);
  return message ? { status: 'failed', message } : { status: 'synced' };
}
