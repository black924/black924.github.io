// Analytics screen data: realtime/now and analytics/daily, written by functions/src/analytics.
// While the page is visible it asks the server (requestAnalytics) to refresh about once a minute.
import { useEffect, useState } from 'react';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { dataMode, firebaseEnabled, firebaseFunctions, firestore } from '../lib/firebase';
import { addDays } from '../lib/kst';

export interface NamedCount {
  name: string; // ISO country code for countries
  users: number;
}

export interface RealtimeApp {
  appId: string;
  name: string;
  users: number;
  android: number;
  ios: number;
  countries: NamedCount[];
}

export interface Realtime {
  activeUsers: number;
  perMinute: number[]; // index 0 = current minute … 29
  apps: RealtimeApp[];
  countries: NamedCount[];
  updatedAt: Date | null;
  error: string | null;
}

export interface DayPoint {
  date: string;
  dau: number;
  mau: number; // 28-day active users
  newUsers: number;
}

export interface AnalyticsDaily {
  timeZone: string | null;
  total: DayPoint[];
  apps: Record<string, DayPoint[]>;
  names: Record<string, string>;
  updatedAt: Date | null;
  error: string | null;
}

export interface AnalyticsState {
  realtime: Realtime | null;
  daily: AnalyticsDaily | null;
  loading: boolean;
  disabled: boolean; // config/app.ga4PropertyId not set
}

// ---------- Mappers ----------

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const when = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null);
const counts = (v: unknown): NamedCount[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x.name === 'string').map((x) => ({ name: x.name, users: num(x.users) })) : [];
const points = (v: unknown): DayPoint[] =>
  Array.isArray(v)
    ? v.filter((p) => p && typeof p.date === 'string').map((p) => ({ date: p.date, dau: num(p.dau), mau: num(p.mau), newUsers: num(p.newUsers) }))
    : [];

export function toRealtime(d: Record<string, unknown>): Realtime {
  const pm = Array.isArray(d.perMinute) ? d.perMinute : [];
  return {
    activeUsers: num(d.activeUsers),
    perMinute: Array.from({ length: 30 }, (_, i) => num(pm[i])),
    apps: Array.isArray(d.apps)
      ? d.apps
          .filter((a) => a && typeof a.appId === 'string')
          .map((a) => ({ appId: a.appId, name: str(a.name) ?? a.appId, users: num(a.users), android: num(a.android), ios: num(a.ios), countries: counts(a.countries) }))
      : [],
    countries: counts(d.countries),
    updatedAt: when(d.updatedAt),
    error: d.state === 'error' ? str(d.error) ?? '실시간 정보를 불러오지 못했습니다.' : null,
  };
}

export function toDaily(d: Record<string, unknown>): AnalyticsDaily {
  const apps: Record<string, DayPoint[]> = {};
  if (d.apps && typeof d.apps === 'object') for (const [k, v] of Object.entries(d.apps)) apps[k] = points(v);
  const names: Record<string, string> = {};
  if (d.names && typeof d.names === 'object') for (const [k, v] of Object.entries(d.names)) if (typeof v === 'string') names[k] = v;
  return {
    timeZone: str(d.timeZone),
    total: points(d.total),
    apps,
    names,
    updatedAt: when(d.updatedAt),
    error: d.state === 'error' ? str(d.error) ?? '일별 사용자 정보를 불러오지 못했습니다.' : null,
  };
}

// ---------- Derived values (pure, tested) ----------

/** The series up to and including `lastDate`, with missing days filled with 0, newest last. */
export function fillDays(series: DayPoint[], lastDate: string, days: number): DayPoint[] {
  const byDate = new Map(series.map((p) => [p.date, p]));
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(lastDate, -i);
    out.push(byDate.get(date) ?? { date, dau: 0, mau: 0, newUsers: 0 });
  }
  return out;
}

/** Value at `date` and the percent change against `daysBack` earlier (null without a baseline). */
export function changeAt(series: DayPoint[], date: string, key: 'dau' | 'mau' | 'newUsers', daysBack = 7) {
  const byDate = new Map(series.map((p) => [p.date, p]));
  const value = byDate.get(date)?.[key] ?? 0;
  const base = byDate.get(addDays(date, -daysBack))?.[key] ?? 0;
  return { value, base, change: base > 0 ? ((value - base) / base) * 100 : null };
}

/** Korean country name from an ISO code ("KR" → "대한민국"); unknown codes stay as they are. */
const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['ko'], { type: 'region' });
  } catch {
    return null;
  }
})();
export function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code === '(not set)' ? '알 수 없음' : code;
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

// ---------- Mock (no Firebase config) ----------

function mockSeries(base: number, mauBase: number, seed: number, today: string): DayPoint[] {
  return Array.from({ length: 60 }, (_, i) => {
    const date = addDays(today, i - 59);
    const wave = 1 + 0.12 * Math.sin((i + seed) / 1.1) + i * 0.004;
    return { date, dau: Math.round(base * wave), mau: Math.round(mauBase * (1 + i * 0.003)), newUsers: Math.round(base * 0.18 * wave) };
  });
}

export function mockAnalytics(today: string): { realtime: Realtime; daily: AnalyticsDaily } {
  const apps = { noiselog: mockSeries(820, 9_400, 1, today), defectchecker: mockSeries(240, 3_100, 3, today), vinylwave: mockSeries(130, 1_600, 5, today) };
  const total = apps.noiselog.map((p, i) => ({
    date: p.date,
    dau: p.dau + apps.defectchecker[i].dau + apps.vinylwave[i].dau,
    mau: p.mau + apps.defectchecker[i].mau + apps.vinylwave[i].mau,
    newUsers: p.newUsers + apps.defectchecker[i].newUsers + apps.vinylwave[i].newUsers,
  }));
  return {
    realtime: {
      activeUsers: 41,
      perMinute: Array.from({ length: 30 }, (_, i) => Math.max(1, Math.round(7 + 3 * Math.sin(i / 2.5) - i / 12))),
      apps: [
        { appId: 'noiselog', name: '층소일지', users: 29, android: 21, ios: 8, countries: [{ name: 'KR', users: 26 }, { name: 'US', users: 2 }, { name: 'JP', users: 1 }] },
        { appId: 'defectchecker', name: '셀프사전점검', users: 9, android: 6, ios: 3, countries: [{ name: 'KR', users: 9 }] },
        { appId: 'vinylwave', name: 'Vinyl Wave', users: 3, android: 0, ios: 3, countries: [{ name: 'JP', users: 2 }, { name: 'US', users: 1 }] },
      ],
      countries: [{ name: 'KR', users: 35 }, { name: 'JP', users: 3 }, { name: 'US', users: 3 }],
      updatedAt: new Date(),
      error: null,
    },
    daily: { timeZone: 'Asia/Seoul', total, apps, names: {}, updatedAt: new Date(), error: null },
  };
}

// ---------- Hook ----------

const REFRESH_MS = 60_000;

export function useAnalytics(today: string): AnalyticsState {
  const [state, setState] = useState<AnalyticsState>(() =>
    firebaseEnabled ? { realtime: null, daily: null, loading: true, disabled: false } : { ...mockAnalytics(today), loading: false, disabled: false },
  );

  useEffect(() => {
    if (!firebaseEnabled) return;
    const db = firestore();
    let seen = 0;
    const loaded = () => (++seen >= 2 ? { loading: false } : {});
    const unsubs = [
      onSnapshot(
        doc(db, 'realtime', 'now'),
        (s) => setState((p) => ({ ...p, ...loaded(), realtime: s.exists() ? toRealtime(s.data()) : null })),
        (e) => console.error('Firestore realtime:', e.code),
      ),
      onSnapshot(
        doc(db, 'analytics', 'daily'),
        (s) => setState((p) => ({ ...p, ...loaded(), daily: s.exists() ? toDaily(s.data()) : null })),
        (e) => console.error('Firestore analytics:', e.code),
      ),
    ];
    if (dataMode !== 'live') return () => unsubs.forEach((u) => u());

    const call = httpsCallable<void, { status: string }>(firebaseFunctions(), 'requestAnalytics', { timeout: 65_000 });
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      call()
        .then((r) => setState((p) => ({ ...p, disabled: r.data.status === 'disabled' })))
        .catch((e) => console.error('requestAnalytics:', e?.code ?? e));
    };
    tick();
    const t = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      unsubs.forEach((u) => u());
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  return state;
}
