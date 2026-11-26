// Google Analytics 4 (the property Firebase Analytics feeds). Read-only, server side.
// Data API v1beta: runRealtimeReport (last 30 minutes) and runReport.
//   developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties
// Admin API v1beta: properties.get (timeZone), properties.dataStreams.list (package name / bundle id per stream).
//   developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/properties.dataStreams
// Access: the Functions runtime service account is a Viewer on the property (the property may be in another account).
import { GoogleAuth } from 'google-auth-library';
import { db } from '../shared/firestore';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/analytics.readonly'] });

export class AnalyticsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function analyticsErrorMessage(e: unknown): string {
  if (e instanceof AnalyticsError && (e.status === 401 || e.status === 403)) {
    return 'Google Analytics 속성에 접근할 수 없습니다. 서비스 계정이 속성의 뷰어인지 확인하세요.';
  }
  if (e instanceof AnalyticsError && e.status === 429) return 'Google Analytics 할당량을 넘었습니다. 잠시 뒤 다시 시도합니다.';
  return 'Google Analytics 데이터를 불러오지 못했습니다.';
}

async function call<T>(url: string, body?: unknown): Promise<T> {
  const token = await auth.getAccessToken();
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new AnalyticsError(res.status, `GA4 request failed (${res.status})`);
  return (await res.json()) as T;
}

export interface ReportRow {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
}
export interface ReportResponse {
  rows?: ReportRow[];
}

const DATA = 'https://analyticsdata.googleapis.com/v1beta/properties';
const ADMIN = 'https://analyticsadmin.googleapis.com/v1beta/properties';

export const runRealtimeReport = (propertyId: string, body: object) =>
  call<ReportResponse>(`${DATA}/${encodeURIComponent(propertyId)}:runRealtimeReport`, body);

export const runReport = (propertyId: string, body: object) =>
  call<ReportResponse>(`${DATA}/${encodeURIComponent(propertyId)}:runReport`, body);

export async function propertyTimeZone(propertyId: string): Promise<string | null> {
  const p = await call<{ timeZone?: string }>(`${ADMIN}/${encodeURIComponent(propertyId)}`);
  return p.timeZone ?? null;
}

interface DataStream {
  name?: string; // properties/{p}/dataStreams/{id}
  type?: string;
  displayName?: string;
  androidAppStreamData?: { packageName?: string };
  iosAppStreamData?: { bundleId?: string };
}

export interface Stream {
  id: string;
  name: string;
  platform: 'android' | 'ios' | 'web';
  appKey: string | null; // package name or bundle id
}

export async function listStreams(propertyId: string): Promise<Stream[]> {
  const res = await call<{ dataStreams?: DataStream[] }>(`${ADMIN}/${encodeURIComponent(propertyId)}/dataStreams?pageSize=200`);
  return (res.dataStreams ?? []).map(toStream);
}

export function toStream(d: DataStream): Stream {
  const id = d.name?.split('/').pop() ?? '';
  const platform = d.androidAppStreamData ? 'android' : d.iosAppStreamData ? 'ios' : 'web';
  return {
    id,
    name: d.displayName ?? id,
    platform,
    appKey: d.androidAppStreamData?.packageName ?? d.iosAppStreamData?.bundleId ?? null,
  };
}

export interface StreamApp {
  appId: string;
  platform: Stream['platform'];
  name: string; // stream name, shown when the stream matches no dashboard app
}

/** Stream id → dashboard app (apps.playPackage / apps.appStoreBundleId), else `ga_{streamId}`. */
export function streamAppMap(streams: Stream[], apps: { id: string; playPackage?: string; appStoreBundleId?: string }[]): Map<string, StreamApp> {
  const byKey = new Map<string, string>();
  for (const a of apps) {
    if (a.playPackage) byKey.set(`android:${a.playPackage}`, a.id);
    if (a.appStoreBundleId) byKey.set(`ios:${a.appStoreBundleId}`, a.id);
  }
  const out = new Map<string, StreamApp>();
  for (const s of streams) {
    const appId = (s.appKey && byKey.get(`${s.platform}:${s.appKey}`)) || `ga_${s.id}`;
    out.set(s.id, { appId, platform: s.platform, name: s.name });
  }
  return out;
}

export interface PropertyStreams {
  streams: Stream[];
  map: Map<string, StreamApp>;
}

const cache = new Map<string, { at: number; streams: Stream[] }>();

/** Streams change rarely, so they are cached per property for an hour; the app list is read every time. */
export async function streamApps(propertyId: string): Promise<PropertyStreams> {
  const hit = cache.get(propertyId);
  const fresh = hit && Date.now() - hit.at < 3_600_000;
  const [streams, apps] = await Promise.all([fresh ? hit.streams : listStreams(propertyId), db.collection('apps').get()]);
  if (!fresh) cache.set(propertyId, { at: Date.now(), streams });
  const map = streamAppMap(
    streams,
    apps.docs.map((d) => ({ id: d.id, playPackage: d.get('playPackage'), appStoreBundleId: d.get('appStoreBundleId') })),
  );
  return { streams, map };
}

/** config/app.ga4PropertyIds (array) and/or ga4PropertyId (string, may be comma separated) → numeric ids. */
export function propertyIds(config: { ga4PropertyIds?: unknown; ga4PropertyId?: unknown }): string[] {
  const raw: unknown[] = [
    ...(Array.isArray(config.ga4PropertyIds) ? config.ga4PropertyIds : []),
    ...(typeof config.ga4PropertyId === 'string' ? config.ga4PropertyId.split(',') : []),
  ];
  const ids = raw.filter((v): v is string => typeof v === 'string').map((v) => v.trim().replace(/^properties\//, ''));
  return [...new Set(ids.filter((v) => /^\d+$/.test(v)))];
}

export const metric = (r: ReportRow, i = 0) => Number(r.metricValues?.[i]?.value ?? 0) || 0;
export const dimension = (r: ReportRow, i = 0) => r.dimensionValues?.[i]?.value ?? '';
