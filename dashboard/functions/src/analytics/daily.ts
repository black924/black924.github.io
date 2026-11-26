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

export interface DailyData {
  timeZone: string | null;
  total: DayPoint[];
  series: Record<string, DayPoint[]>;
  names: Record<string, string>;
}

export async function fetchDaily(propertyId: string, streams: Map<string, StreamApp>): Promise<DailyData> {
  const dateRanges = [{ startDate: `${DAYS - 1}daysAgo`, endDate: 'today' }];
  const [timeZone, all, perStream] = await Promise.all([
    propertyTimeZone(propertyId),
    runReport(propertyId, { dateRanges, dimensions: [{ name: 'date' }], metrics: METRICS, limit: '1000' }),
    runReport(propertyId, { dateRanges, dimensions: [{ name: 'date' }, { name: 'streamId' }], metrics: METRICS, limit: '10000' }),
  ]);
  return { timeZone, total: totalSeries(all), ...appSeries(perStream, streams) };
}

function addSeries(into: Map<string, DayPoint>, points: DayPoint[]) {
  for (const p of points) {
    const q = into.get(p.date) ?? point(p.date, { dau: 0, mau: 0, newUsers: 0 });
    q.dau += p.dau;
    q.mau += p.mau;
    q.newUsers += p.newUsers;
    into.set(p.date, q);
  }
}

const sorted = (m: Map<string, DayPoint>) => [...m.values()].sort((a, b) => a.date.localeCompare(b.date));

/** Several GA4 properties into one view: totals and same-app series are summed per date. */
export function mergeDaily(parts: DailyData[]) {
  const total = new Map<string, DayPoint>();
  const apps = new Map<string, Map<string, DayPoint>>();
  const names: Record<string, string> = {};
  for (const p of parts) {
    addSeries(total, p.total);
    for (const [appId, points] of Object.entries(p.series)) {
      const m = apps.get(appId) ?? new Map<string, DayPoint>();
      addSeries(m, points);
      apps.set(appId, m);
    }
    for (const [k, v] of Object.entries(p.names)) names[k] ??= v;
  }
  const zones = [...new Set(parts.map((p) => p.timeZone).filter(Boolean))];
  return {
    timeZone: zones.length === 1 ? zones[0] : zones.length ? zones.join(', ') : null,
    total: sorted(total),
    apps: Object.fromEntries([...apps].map(([k, m]) => [k, sorted(m)])),
    names,
  };
}

export async function writeDaily(parts: DailyData[], streams: object[], error: string | null): Promise<void> {
  await db.doc('analytics/daily').set({ ...mergeDaily(parts), streams, state: error ? 'error' : 'ok', error, updatedAt: Timestamp.now() });
}
