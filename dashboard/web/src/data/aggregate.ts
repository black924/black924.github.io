// Turns raw Firestore documents into what the dashboard renders.
// Pure function: same input → same output, so it is unit-tested and shared by mock + Firestore.
import { addDays, kstDateKey, kstParts, kstStartOfDay, shortDay } from '../lib/kst';
import type {
  AdUnitRow, AppInfo, AppRow, Bucket, DailyDoc, DashboardData, DataStatus, Period, RawData, Split, Store,
  StoreSummary, SyncInfo, SyncSource,
} from './types';

const SYNC_ORDER: SyncSource[] = ['admob', 'google_play', 'app_store', 'reconcile'];

const zero = (): Split => ({ ad: 0, inapp: 0, paid: 0 });
const add = (a: Split, b: Split) => {
  a.ad += b.ad;
  a.inapp += b.inapp;
  a.paid += b.paid;
};
const sum = (s: Split) => s.ad + s.inapp + s.paid;
const pad = (n: number) => String(n).padStart(2, '0');

export function dailySplit(d: DailyDoc): Split {
  return {
    ad: d.ad.totalMicros,
    inapp: d.inapp.google + d.inapp.apple,
    paid: d.paid.google + d.paid.apple,
  };
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Date keys shown for a period, and the matching comparison window (same length, ends one window earlier). */
export function periodDays(period: Period, now: Date): { days: string[]; prevDays: string[] } {
  const today = kstDateKey(now);
  const p = kstParts(now);
  if (period === 'today') return { days: [today], prevDays: [addDays(today, -1)] };
  if (period === '7d') {
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
    return { days, prevDays: days.map((d) => addDays(d, -7)) };
  }
  const days = Array.from({ length: p.day }, (_, i) => addDays(today, i - p.day + 1));
  const py = p.month === 1 ? p.year - 1 : p.year;
  const pm = p.month === 1 ? 12 : p.month - 1;
  const prevLen = Math.min(p.day, daysInMonth(py, pm));
  const prevDays = Array.from({ length: prevLen }, (_, i) => `${py}-${pad(pm)}-${pad(i + 1)}`);
  return { days, prevDays };
}

/** One `daily` range that serves every period: earliest of (first day of last month, D-13) … today. */
export function dailyWindow(now: Date): { from: string; to: string } {
  const to = kstDateKey(now);
  const p = kstParts(now);
  const py = p.month === 1 ? p.year - 1 : p.year;
  const pm = p.month === 1 ? 12 : p.month - 1;
  const lastMonthStart = `${py}-${pad(pm)}-01`;
  const d13 = addDays(to, -13);
  return { from: d13 < lastMonthStart ? d13 : lastMonthStart, to };
}

/** Share of the current KST day that has elapsed, 0..1. */
function dayFraction(now: Date): number {
  return (now.getTime() - kstStartOfDay(now).getTime()) / 86_400_000;
}

export function buildDashboard(raw: RawData, period: Period, now: Date): DashboardData {
  const today = kstDateKey(now);
  const { hour, minute } = kstParts(now);
  const { days, prevDays } = periodDays(period, now);

  // Index daily docs by date.
  const byDate = new Map<string, { split: Split; status: DataStatus }>();
  for (const d of raw.daily) {
    const cur = byDate.get(d.date) ?? { split: zero(), status: 'final' as DataStatus };
    add(cur.split, dailySplit(d));
    if (d.status === 'estimated') cur.status = 'estimated';
    byDate.set(d.date, cur);
  }
  const dayStatus = (d: string): DataStatus => (d === today ? 'estimated' : byDate.get(d)?.status ?? 'final');

  // Chart buckets: the whole period on the axis, with the comparison period as grey bars.
  const dayTotal = (d: string) => (byDate.has(d) ? sum(byDate.get(d)!.split) : null);
  let buckets: Bucket[];
  if (period === 'today') {
    const yesterday = prevDays[0];
    const hours = new Map(raw.hourly.filter((h) => h.date === today).map((h) => [h.hour, h]));
    const yHours = new Map(raw.hourly.filter((h) => h.date === yesterday).map((h) => [h.hour, h]));
    buckets = Array.from({ length: 24 }, (_, h) => {
      const doc = h <= hour ? hours.get(h) : undefined;
      const y = yHours.get(h);
      return {
        key: `${today}_${pad(h)}`,
        label: `${h}시`,
        title: `${h}:00–${h + 1}:00`,
        partial: h === hour,
        future: h > hour,
        status: 'estimated' as const,
        ad: doc?.ad ?? 0,
        inapp: doc?.inapp ?? 0,
        paid: doc?.paid ?? 0,
        // No hourly docs at all for yesterday (e.g. first day after connecting) → no grey bars.
        prev: yHours.size ? (y ? y.ad + y.inapp + y.paid : 0) : null,
        prevTitle: `어제 ${h}:00–${h + 1}:00`,
      };
    });
  } else {
    // 7d: the 7 days ending today vs the 7 before. Month: every day of this month vs the same day last month.
    let axis = days;
    let prevOf = (i: number) => prevDays[i];
    if (period === 'month') {
      const { year, month } = kstParts(now);
      const len = daysInMonth(year, month);
      const py = month === 1 ? year - 1 : year;
      const pm = month === 1 ? 12 : month - 1;
      const prevLen = daysInMonth(py, pm);
      axis = Array.from({ length: len }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);
      prevOf = (i: number) => (i < prevLen ? `${py}-${pad(pm)}-${pad(i + 1)}` : '');
    }
    buckets = axis.map((d, i) => {
      const p = prevOf(i);
      return {
        key: d,
        label: shortDay(d),
        title: shortDay(d),
        partial: d === today,
        future: d > today,
        status: dayStatus(d),
        ...(d <= today ? byDate.get(d)?.split ?? zero() : zero()),
        prev: p ? dayTotal(p) : null,
        prevTitle: p ? shortDay(p) : '',
      };
    });
  }

  // Totals come from `daily` so they match the app table, ad sources and stores.
  const daySet = new Set(days);
  const current = raw.daily.filter((d) => daySet.has(d.date));
  const totals = zero();
  for (const d of current) add(totals, dailySplit(d));

  // Comparison: same elapsed time in the previous window.
  let previousTotal = 0;
  if (period === 'today') {
    const yesterday = prevDays[0];
    const yHours = raw.hourly.filter((h) => h.date === yesterday);
    if (yHours.length > 0) {
      for (const h of yHours) {
        const t = h.ad + h.inapp + h.paid;
        if (h.hour < hour) previousTotal += t;
        else if (h.hour === hour) previousTotal += Math.round((t * minute) / 60);
      }
    } else {
      previousTotal = Math.round(sum(byDate.get(yesterday)?.split ?? zero()) * dayFraction(now));
    }
  } else {
    prevDays.forEach((d, i) => {
      const t = sum(byDate.get(d)?.split ?? zero());
      previousTotal += i === prevDays.length - 1 ? Math.round(t * dayFraction(now)) : t;
    });
  }

  // Ad sources
  const adSources = { admob: 0, unity: 0, other: 0 };
  for (const d of current) {
    adSources.admob += d.ad.bySource.admob;
    adSources.unity += d.ad.bySource.unity;
    adSources.other += d.ad.bySource.other;
  }

  // Stores
  const store = (s: Store): StoreSummary => {
    const refunds = raw.refundsThisMonth.filter((t) => t.store === s);
    return {
      amount: current.reduce((acc, d) => acc + d.inapp[s] + d.paid[s], 0),
      activeSubscribers: raw.subscribers[s] ?? null,
      refundCount: refunds.length,
      refundMicros: refunds.reduce((acc, t) => acc + Math.abs(t.amountKrwMicros), 0),
    };
  };

  // Apps (include apps with no revenue yet, and unknown appIds found in daily docs)
  const appsById: Record<string, AppInfo> = Object.fromEntries(raw.apps.map((a) => [a.id, a]));
  const emptyRow = (app: AppInfo): AppRow => ({ app, ...zero(), stores: { google: 0, apple: 0 }, adUnits: [] });
  const rows = new Map<string, AppRow>(raw.apps.map((a) => [a.id, emptyRow(a)]));
  const unitsByApp = new Map<string, Map<string, AdUnitRow>>();
  for (const d of current) {
    let row = rows.get(d.appId);
    if (!row) {
      const app: AppInfo = { id: d.appId, name: d.appId, platform: [], iconColor: '#4A5468' };
      appsById[d.appId] = app;
      row = emptyRow(app);
      rows.set(d.appId, row);
    }
    add(row, dailySplit(d));
    row.stores.google += d.inapp.google + d.paid.google;
    row.stores.apple += d.inapp.apple + d.paid.apple;
    const units = unitsByApp.get(d.appId) ?? new Map<string, AdUnitRow>();
    for (const [key, u] of Object.entries(d.ad.units ?? {})) {
      const cur = units.get(key) ?? { key, name: u.name, platform: u.platform, format: u.format, requests: 0, matchedRequests: 0, impressions: 0, clicks: 0, earningsMicros: 0 };
      cur.requests += u.requests;
      cur.matchedRequests += u.matchedRequests;
      cur.impressions += u.impressions;
      cur.clicks += u.clicks;
      cur.earningsMicros += u.earningsMicros;
      units.set(key, cur);
    }
    unitsByApp.set(d.appId, units);
  }
  for (const [appId, units] of unitsByApp) {
    rows.get(appId)!.adUnits = [...units.values()].sort((a, b) => b.earningsMicros - a.earningsMicros || b.impressions - a.impressions);
  }
  const appRows = [...rows.values()].sort((a, b) => sum(b) - sum(a) || a.app.name.localeCompare(b.app.name));

  // Sync status: always list every source; missing docs mean "not connected yet".
  const syncBySource = new Map(raw.sync.map((s) => [s.source, s]));
  const sync: SyncInfo[] = SYNC_ORDER.map((source) => syncBySource.get(source) ?? { source, state: 'pending' });
  const lastSyncAt = raw.sync
    .filter((s) => s.source !== 'reconcile')
    .reduce<Date | null>((acc, s) => (!acc || s.lastRunAt > acc ? s.lastRunAt : acc), null);

  return {
    period,
    now,
    buckets,
    totals,
    previousTotal,
    compareLabel: period === 'today' ? '어제 같은 시간 대비' : period === '7d' ? '직전 7일 대비' : '지난달 같은 기간 대비',
    prevLabel: period === 'today' ? '어제' : period === '7d' ? '이전 7일' : '지난달',
    hasEstimated: buckets.some((b) => !b.future && b.status === 'estimated') || current.some((d) => d.status === 'estimated'),
    adSources,
    stores: { google: store('google'), apple: store('apple') },
    appRows,
    appsById,
    transactions: raw.transactions.slice(0, 10),
    sync,
    lastSyncAt,
    fx: raw.fx,
    revenueBasis: raw.config?.revenueBasis ?? 'gross',
  };
}
