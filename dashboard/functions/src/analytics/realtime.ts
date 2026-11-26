// Realtime active users (last 30 minutes) → realtime/now.
// minutesAgo "00" is the current minute. Totals come from a report without dimensions because a user
// can appear under several streams or countries.
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../shared/firestore';
import { dimension, metric, runRealtimeReport, type ReportResponse, type StreamApp } from './ga4';

const MINUTES = 30;

export interface NamedCount {
  name: string;
  users: number;
}

export interface RealtimeApp {
  appId: string;
  name: string; // stream name (used when the app is not in the dashboard list)
  users: number;
  android: number;
  ios: number;
  countries: NamedCount[];
}

/** Index 0 = current minute … 29. Missing minutes are 0. */
export function perMinute(res: ReportResponse): number[] {
  const out = new Array<number>(MINUTES).fill(0);
  for (const r of res.rows ?? []) {
    const m = Number(dimension(r));
    if (Number.isInteger(m) && m >= 0 && m < MINUTES) out[m] = metric(r);
  }
  return out;
}

export function total(res: ReportResponse): number {
  return res.rows?.[0] ? metric(res.rows[0]) : 0;
}

export function topCounts(entries: Iterable<[string, number]>, top: number): NamedCount[] {
  return [...entries]
    .filter(([, n]) => n > 0)
    .map(([name, users]) => ({ name, users }))
    .sort((a, b) => b.users - a.users || a.name.localeCompare(b.name))
    .slice(0, top);
}

/** Rows of a streamId × countryId report grouped into dashboard apps. */
export function realtimeApps(res: ReportResponse, streams: Map<string, StreamApp>): RealtimeApp[] {
  const apps = new Map<string, { name: string; android: number; ios: number; countries: Map<string, number> }>();
  for (const r of res.rows ?? []) {
    const streamId = dimension(r, 0);
    const country = dimension(r, 1) || '(not set)';
    const n = metric(r);
    const s = streams.get(streamId) ?? { appId: `ga_${streamId}`, platform: 'web' as const, name: streamId };
    const a = apps.get(s.appId) ?? { name: s.name, android: 0, ios: 0, countries: new Map() };
    if (s.platform === 'android') a.android += n;
    if (s.platform === 'ios') a.ios += n;
    a.countries.set(country, (a.countries.get(country) ?? 0) + n);
    apps.set(s.appId, a);
  }
  return [...apps]
    .map(([appId, a]) => {
      const users = [...a.countries.values()].reduce((x, y) => x + y, 0);
      return { appId, name: a.name, users, android: a.android, ios: a.ios, countries: topCounts(a.countries, 5) };
    })
    .filter((a) => a.users > 0)
    .sort((x, y) => y.users - x.users);
}

export async function syncRealtime(propertyId: string, streams: Map<string, StreamApp>): Promise<void> {
  const users = [{ name: 'activeUsers' }];
  const [all, minutes, byStreamCountry, byCountry] = await Promise.all([
    runRealtimeReport(propertyId, { metrics: users }),
    runRealtimeReport(propertyId, { dimensions: [{ name: 'minutesAgo' }], metrics: users }),
    runRealtimeReport(propertyId, { dimensions: [{ name: 'streamId' }, { name: 'countryId' }], metrics: users, limit: '1000' }),
    runRealtimeReport(propertyId, { dimensions: [{ name: 'countryId' }], metrics: users, limit: '50' }),
  ]);
  await db.doc('realtime/now').set({
    activeUsers: total(all),
    perMinute: perMinute(minutes),
    apps: realtimeApps(byStreamCountry, streams),
    countries: topCounts((byCountry.rows ?? []).map((r) => [dimension(r) || '(not set)', metric(r)]), 10),
    state: 'ok',
    error: null,
    updatedAt: Timestamp.now(),
  });
}
