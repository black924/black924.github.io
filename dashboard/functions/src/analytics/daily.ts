// Daily active users (DAU), 28-day active users (shown as MAU) and new users for the last 60 days
// → analytics/daily. Dates are in the GA4 property's time zone (stored as `timeZone`).
// Per-app values add up the app's streams (Android + iOS); the property total is its own deduplicated query.
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../shared/firestore';
import { dimension, metric, propertyTimeZone, runReport, type ReportResponse, type StreamApp } from './ga4';

export const DAYS = 60;

export interface DayPoint {
  date: string; // YYYY-MM-DD
  dau: number;
  mau: number; // active28DayUsers
  newUsers: number;
}

const METRICS = [{ name: 'activeUsers' }, { name: 'active28DayUsers' }, { name: 'newUsers' }];

/** GA4 `date` dimension is YYYYMMDD. */
export const isoDate = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null);

const point = (date: string, r: { dau: number; mau: number; newUsers: number }): DayPoint => ({ date, ...r });

export function totalSeries(res: ReportResponse): DayPoint[] {
  const out: DayPoint[] = [];
  for (const r of res.rows ?? []) {
    const date = isoDate(dimension(r));
    if (date) out.push(point(date, { dau: metric(r, 0), mau: metric(r, 1), newUsers: metric(r, 2) }));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** date × streamId rows → appId → series (streams of one app summed per day). */
export function appSeries(res: ReportResponse, streams: Map<string, StreamApp>): { series: Record<string, DayPoint[]>; names: Record<string, string> } {
  const byApp = new Map<string, Map<string, DayPoint>>();
  const names: Record<string, string> = {};
  for (const r of res.rows ?? []) {
    const date = isoDate(dimension(r, 0));
    if (!date) continue;
    const streamId = dimension(r, 1);
    const s = streams.get(streamId);
    const appId = s?.appId ?? `ga_${streamId}`;
    names[appId] ??= s?.name ?? streamId;
    const days = byApp.get(appId) ?? new Map<string, DayPoint>();
    const p = days.get(date) ?? point(date, { dau: 0, mau: 0, newUsers: 0 });
    p.dau += metric(r, 0);
    p.mau += metric(r, 1);
    p.newUsers += metric(r, 2);
    days.set(date, p);
    byApp.set(appId, days);
  }
  const series: Record<string, DayPoint[]> = {};
  for (const [appId, days] of byApp) series[appId] = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { series, names };
}

export async function syncAnalyticsDaily(propertyId: string, streams: Map<string, StreamApp>): Promise<void> {
  const dateRanges = [{ startDate: `${DAYS - 1}daysAgo`, endDate: 'today' }];
  const [timeZone, all, perStream] = await Promise.all([
    propertyTimeZone(propertyId),
    runReport(propertyId, { dateRanges, dimensions: [{ name: 'date' }], metrics: METRICS, limit: '1000' }),
    runReport(propertyId, { dateRanges, dimensions: [{ name: 'date' }, { name: 'streamId' }], metrics: METRICS, limit: '10000' }),
  ]);
  const { series, names } = appSeries(perStream, streams);
  await db.doc('analytics/daily').set({
    timeZone,
    total: totalSeries(all),
    apps: series,
    names,
    state: 'ok',
    error: null,
    updatedAt: Timestamp.now(),
  });
}
