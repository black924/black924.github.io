// Pure transforms for AdMob API responses (no I/O), so they can be unit-tested.
// Response shapes follow https://developers.google.com/admob/api/reference/rest/v1/accounts.mediationReport/generate
import { fromCompactDate } from '../shared/kst';
import { parseMicros } from '../shared/money';

export type AdSourceBucket = 'admob' | 'unity' | 'other';

// Documented example ID for "AdMob Network" on the generate page's AD_SOURCE description.
export const ADMOB_NETWORK_SOURCE_ID = '5450213213286189855';

export interface ReportRow {
  date: string; // YYYY-MM-DD in the account's reporting time zone
  admobAppId: string; // ca-app-pub-...~...
  appLabel?: string;
  adSourceId: string;
  adSourceLabel?: string;
  micros: number; // in the report currency
}

interface DimValue {
  value?: string;
  displayLabel?: string;
}

// TODO(verify): the docs' only example shows ESTIMATED_EARNINGS as {"decimal_value": "..."}; proto-JSON
// would normally be {"microsValue": "..."}. Accept every plausible wrapper until confirmed against a live response.
function metricMicros(m: Record<string, unknown> | undefined): number {
  if (!m) return 0;
  const raw = m.microsValue ?? m.decimalValue ?? m.decimal_value ?? m.integerValue;
  return raw === undefined ? 0 : parseMicros(raw);
}

// Integer metrics parse correctly against the live API (checked 2026-11-10); other wrappers kept as fallbacks.
function metricInt(m: Record<string, unknown> | undefined): number {
  if (!m) return 0;
  const raw = m.integerValue ?? m.decimalValue ?? m.decimal_value ?? m.doubleValue;
  return raw === undefined ? 0 : parseMicros(raw);
}

/** Parses the generate response (a JSON array of {header} | {row} | {footer}). */
export function parseMediationReport(body: unknown): { currency: string | null; rows: ReportRow[] } {
  if (!Array.isArray(body)) throw new Error('Unexpected report response: not an array');
  let currency: string | null = null;
  const rows: ReportRow[] = [];
  for (const part of body as Record<string, any>[]) {
    if (part.header) currency = part.header.localizationSettings?.currencyCode ?? null;
    if (!part.row) continue;
    const dims = (part.row.dimensionValues ?? {}) as Record<string, DimValue>;
    const metrics = (part.row.metricValues ?? {}) as Record<string, Record<string, unknown>>;
    if (!dims.DATE?.value || !dims.APP?.value) continue;
    rows.push({
      date: fromCompactDate(dims.DATE.value),
      admobAppId: dims.APP.value,
      appLabel: dims.APP.displayLabel,
      adSourceId: dims.AD_SOURCE?.value ?? '',
      adSourceLabel: dims.AD_SOURCE?.displayLabel,
      micros: metricMicros(metrics.ESTIMATED_EARNINGS),
    });
  }
  return { currency, rows };
}

/** Unity is already inside AdMob mediation totals; this only splits the bar, it never adds. */
export function classifySource(id: string, label?: string): AdSourceBucket {
  if (id === ADMOB_NETWORK_SOURCE_ID || /^admob/i.test(label ?? '')) return 'admob';
  if (/unity/i.test(label ?? '')) return 'unity';
  return 'other';
}

export interface AdmobApp {
  appId: string; // ca-app-pub-...~...
  platform: string; // "ANDROID" | "IOS"
  storeId?: string; // linkedAppInfo.appStoreId: package name (Android) or numeric id (iOS)
  name: string;
}

export interface OurApp {
  id: string;
  playPackage?: string;
  appStoreAppId?: string;
  admobAppIds?: string[]; // set in apps.json for AdMob apps not linked to a store yet
}

/** Id used for an AdMob app that matches none of ours. */
export const syntheticAppId = (admobAppId: string) => `admob_${admobAppId.split('~')[1] ?? admobAppId}`;
export const isSyntheticAppId = (id: string) => id.startsWith('admob_');

/**
 * Maps AdMob app IDs to our apps/{id}: by store ID first, then by an AdMob app ID listed on one of
 * our apps (for apps not linked to a store yet). Unmatched AdMob apps get a stable synthetic id.
 */
export function mapApps(admobApps: AdmobApp[], ours: OurApp[]) {
  const byStoreId = new Map<string, string>();
  for (const a of ours) {
    if (a.playPackage) byStoreId.set(a.playPackage, a.id);
    if (a.appStoreAppId) byStoreId.set(a.appStoreAppId, a.id);
  }
  const byAdmobId = new Map<string, string>();
  for (const a of ours) {
    if (isSyntheticAppId(a.id)) continue;
    for (const id of a.admobAppIds ?? []) byAdmobId.set(id, a.id);
  }
  const map = new Map<string, string>();
  const unmatched: (AdmobApp & { ourId: string })[] = [];
  for (const app of admobApps) {
    const ourId = (app.storeId && byStoreId.get(app.storeId)) || byAdmobId.get(app.appId);
    if (ourId) {
      map.set(app.appId, ourId);
    } else {
      const synthetic = syntheticAppId(app.appId);
      map.set(app.appId, synthetic);
      unmatched.push({ ...app, ourId: synthetic });
    }
  }
  return { map, unmatched };
}

export interface DailyAd {
  date: string;
  appId: string;
  totalMicros: number;
  bySource: Record<AdSourceBucket, number>;
}

/** Sums report rows into one entry per (date, our app). */
export function aggregateDaily(rows: ReportRow[], appMap: Map<string, string>): Map<string, DailyAd> {
  const out = new Map<string, DailyAd>();
  for (const r of rows) {
    const appId = appMap.get(r.admobAppId) ?? syntheticAppId(r.admobAppId);
    const key = `${r.date}_${appId}`;
    const cur = out.get(key) ?? { date: r.date, appId, totalMicros: 0, bySource: { admob: 0, unity: 0, other: 0 } };
    cur.totalMicros += r.micros;
    cur.bySource[classifySource(r.adSourceId, r.adSourceLabel)] += r.micros;
    out.set(key, cur);
  }
  return out;
}

export interface HourlyBase {
  date: string;
  totalMicros: number;
}

/**
 * AdMob reports have no HOUR dimension. We approximate the hourly ad chart from the growth of
 * today's total between polls: the increase lands in the current KST hour. On the first poll of a
 * day there is no baseline, so today's total so far is spread evenly over the elapsed hours.
 * Decreases (AdMob revising estimates down) are not subtracted from past hours.
 */
export function planHourlyAd(prev: HourlyBase | undefined, today: string, hour: number, todayTotal: number) {
  const increments: { hour: number; micros: number }[] = [];
  if (prev && prev.date === today) {
    const delta = todayTotal - prev.totalMicros;
    if (delta > 0) increments.push({ hour, micros: delta });
  } else if (todayTotal > 0) {
    const per = Math.floor(todayTotal / (hour + 1));
    for (let h = 0; h <= hour; h++) {
      const micros = h === hour ? todayTotal - per * hour : per;
      if (micros > 0) increments.push({ hour: h, micros });
    }
  }
  return { increments, base: { date: today, totalMicros: todayTotal } satisfies HourlyBase };
}

export type UnitPlatform = 'android' | 'ios' | '';

export interface AdUnitStats {
  name: string;
  platform: UnitPlatform; // from the AdMob app the unit belongs to
  format: string; // as reported: lowercase, e.g. "banner", "interstitial", "app_open" (seen 2026-11-10)
  requests: number;
  matchedRequests: number;
  impressions: number;
  clicks: number;
  earningsMicros: number;
}

export interface AdUnitRow extends AdUnitStats {
  date: string;
  admobAppId: string;
  adUnitId: string; // ca-app-pub-.../...
}

/** Parses the DATE × AD_UNIT × FORMAT report. */
export function parseAdUnitReport(body: unknown): AdUnitRow[] {
  if (!Array.isArray(body)) throw new Error('Unexpected report response: not an array');
  const rows: AdUnitRow[] = [];
  for (const part of body as Record<string, any>[]) {
    if (!part.row) continue;
    const dims = (part.row.dimensionValues ?? {}) as Record<string, DimValue>;
    const m = (part.row.metricValues ?? {}) as Record<string, Record<string, unknown>>;
    if (!dims.DATE?.value || !dims.AD_UNIT?.value || !dims.APP?.value) continue;
    rows.push({
      date: fromCompactDate(dims.DATE.value),
      admobAppId: dims.APP.value,
      adUnitId: dims.AD_UNIT.value,
      name: dims.AD_UNIT.displayLabel || dims.AD_UNIT.value,
      platform: '', // filled from the app list in groupAdUnits
      format: dims.FORMAT?.value ?? '',
      requests: metricInt(m.AD_REQUESTS),
      matchedRequests: metricInt(m.MATCHED_REQUESTS),
      impressions: metricInt(m.IMPRESSIONS),
      clicks: metricInt(m.CLICKS),
      earningsMicros: metricMicros(m.ESTIMATED_EARNINGS),
    });
  }
  return rows;
}

/** Firestore map keys cannot contain "/" or "~"; keep the numeric part of the ad unit id. */
export const adUnitKey = (adUnitId: string) => adUnitId.split('/').pop()!.replace(/[^A-Za-z0-9_-]/g, '_');

/** Groups ad unit rows by daily doc id ({date}_{appId}) → { [adUnitKey]: stats }, summing duplicate formats. */
/** "ANDROID" | "IOS" (accounts.apps.list) → our lowercase platform. */
export const toUnitPlatform = (p: string | undefined): UnitPlatform => (p === 'IOS' ? 'ios' : p === 'ANDROID' ? 'android' : '');

export function groupAdUnits(
  rows: AdUnitRow[],
  appMap: Map<string, string>,
  platformByAdmobApp: Map<string, UnitPlatform> = new Map(),
): Map<string, Record<string, AdUnitStats>> {
  const out = new Map<string, Record<string, AdUnitStats>>();
  for (const r of rows) {
    const appId = appMap.get(r.admobAppId) ?? syntheticAppId(r.admobAppId);
    const id = `${r.date}_${appId}`;
    const units = out.get(id) ?? {};
    const key = adUnitKey(r.adUnitId);
    const cur = units[key] ?? { name: r.name, platform: platformByAdmobApp.get(r.admobAppId) ?? '', format: r.format, requests: 0, matchedRequests: 0, impressions: 0, clicks: 0, earningsMicros: 0 };
    cur.requests += r.requests;
    cur.matchedRequests += r.matchedRequests;
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    cur.earningsMicros += r.earningsMicros;
    units[key] = cur;
    out.set(id, units);
  }
  return out;
}
