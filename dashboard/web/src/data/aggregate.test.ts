import { describe, expect, it } from 'vitest';
import { buildDashboard, dailyWindow, periodDays } from './aggregate';
import { applyTransaction, emptyDaily, generateSeed, makeTransaction } from './seed';
import type { DailyDoc, RawData } from './types';

const M = 1_000_000; // micros per won
// 2026-11-10 14:30 KST
const NOW = new Date('2026-11-10T05:30:00Z');

function daily(date: string, appId: string, won: { ad?: number; inapp?: number; paid?: number }, status: DailyDoc['status'] = 'final'): DailyDoc {
  const ad = (won.ad ?? 0) * M;
  return {
    date,
    appId,
    ad: { totalMicros: ad, bySource: { admob: ad, unity: 0, other: 0 } },
    inapp: { google: (won.inapp ?? 0) * M, apple: 0 },
    paid: { google: 0, apple: (won.paid ?? 0) * M },
    status,
  };
}

function raw(partial: Partial<RawData>): RawData {
  return {
    config: null, apps: [], daily: [], hourly: [], transactions: [], refundsThisMonth: [],
    subscribers: {}, sync: [], fx: null, ...partial,
  };
}

describe('periodDays', () => {
  it('uses the previous 7 days for 7d', () => {
    const { days, prevDays } = periodDays('7d', NOW);
    expect(days).toEqual(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
    expect(prevDays[0]).toBe('2026-10-28');
    expect(prevDays[6]).toBe('2026-11-03');
  });

  it('compares month-to-date with the same days of last month, across a year boundary', () => {
    const { days, prevDays } = periodDays('month', new Date('2027-01-05T03:00:00Z'));
    expect(days).toEqual(['2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04', '2027-01-05']);
    expect(prevDays).toEqual(['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']);
  });

  it('clamps to the shorter previous month', () => {
    const { prevDays } = periodDays('month', new Date('2027-03-31T03:00:00Z'));
    expect(prevDays).toHaveLength(28);
    expect(prevDays.at(-1)).toBe('2027-02-28');
  });
});

describe('dailyWindow', () => {
  it('starts at the first day of last month', () => {
    expect(dailyWindow(NOW)).toEqual({ from: '2026-10-01', to: '2026-11-10' });
  });
});

describe('buildDashboard', () => {
  it('sums today from daily docs and compares with yesterday up to the same minute', () => {
    const r = raw({
      daily: [daily('2026-11-10', 'a', { ad: 1000, inapp: 500 }, 'estimated'), daily('2026-11-10', 'b', { paid: 300 }, 'estimated')],
      hourly: [
        { date: '2026-11-09', hour: 13, ad: 600 * M, inapp: 0, paid: 0 }, // fully counted
        { date: '2026-11-09', hour: 14, ad: 120 * M, inapp: 0, paid: 0 }, // half (14:30)
        { date: '2026-11-09', hour: 15, ad: 999 * M, inapp: 0, paid: 0 }, // not yet
        { date: '2026-11-10', hour: 9, ad: 50 * M, inapp: 0, paid: 0 },
      ],
    });
    const d = buildDashboard(r, 'today', NOW);
    expect(d.totals).toEqual({ ad: 1000 * M, inapp: 500 * M, paid: 300 * M });
    expect(d.previousTotal).toBe(660 * M);
    expect(d.buckets).toHaveLength(24); // whole day on the axis
    expect(d.buckets[9].ad).toBe(50 * M);
    expect(d.buckets[14].partial).toBe(true);
    expect(d.buckets[15]).toMatchObject({ future: true, ad: 0, prev: 999 * M });
    expect(d.buckets[13].prev).toBe(600 * M);
    expect(d.buckets[0].prev).toBe(0); // yesterday has hourly docs, just not for 0시
    expect(d.hasEstimated).toBe(true);
  });

  it('prorates the last comparison day by elapsed time for 7d', () => {
    const prev = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'];
    const r = raw({ daily: prev.map((date) => daily(date, 'a', { ad: 2400 })) });
    // 6 full days + 14.5/24 of the last one
    expect(buildDashboard(r, '7d', NOW).previousTotal).toBe(6 * 2400 * M + 1450 * M);
  });

  it('marks only today as partial and keeps final days final', () => {
    const r = raw({ daily: [daily('2026-11-09', 'a', { ad: 1 }), daily('2026-11-10', 'a', { ad: 1 }, 'estimated')] });
    const b = buildDashboard(r, '7d', NOW).buckets;
    expect(b.at(-1)).toMatchObject({ partial: true, status: 'estimated' });
    expect(b.at(-2)).toMatchObject({ partial: false, status: 'final' });
  });

  it('splits store revenue and counts refunds per store', () => {
    const refund = { ...makeTransaction('r1', NOW, true), store: 'google' as const, amountKrwMicros: -4400 * M };
    const r = raw({
      daily: [daily('2026-11-10', 'a', { inapp: 700, paid: 200 }, 'estimated')],
      refundsThisMonth: [refund, { ...refund, id: 'r2', test: true }],
      subscribers: { google: 5 },
    });
    const { stores } = buildDashboard(r, 'today', NOW);
    expect(stores.google).toEqual({ amount: 700 * M, activeSubscribers: 5, refundCount: 1, refundMicros: 4400 * M });
    expect(stores.apple).toEqual({ amount: 200 * M, activeSubscribers: null, refundCount: 0, refundMicros: 0 });
  });

  it('handles an empty project: every sync source pending, no division by zero', () => {
    const d = buildDashboard(raw({}), 'month', NOW);
    expect(d.sync.map((s) => s.state)).toEqual(['pending', 'pending', 'pending', 'pending']);
    expect(d.lastSyncAt).toBeNull();
    expect(d.previousTotal).toBe(0);
    expect(d.appRows).toEqual([]);
  });

  it('keeps revenue from an app missing in the apps collection', () => {
    const d = buildDashboard(raw({ daily: [daily('2026-11-10', 'ghost', { ad: 10 }, 'estimated')] }), 'today', NOW);
    expect(d.appRows[0].app.name).toBe('ghost');
    expect(d.appRows[0].ad).toBe(10 * M);
  });
});

describe('seed + applyTransaction', () => {
  it('generates daily docs whose today total matches hourly', () => {
    const s = generateSeed(NOW);
    const todayDaily = s.daily.filter((d) => d.date === '2026-11-10').reduce((a, d) => a + d.ad.totalMicros, 0);
    const todayHourly = s.hourly.filter((h) => h.date === '2026-11-10').reduce((a, h) => a + h.ad, 0);
    expect(todayDaily).toBe(todayHourly);
    for (const d of s.daily) expect(Number.isInteger(d.ad.totalMicros)).toBe(true);
  });

  it('adds a payment to daily, hourly and the feed; refunds subtract', () => {
    const base = raw({ daily: [emptyDaily('2026-11-10', 'noise')] });
    const tx = { ...makeTransaction('t', NOW), appId: 'noise', type: 'inapp' as const, store: 'apple' as const, amountKrwMicros: 4400 * M };
    const after = applyTransaction(base, tx);
    expect(after.daily[0].inapp.apple).toBe(4400 * M);
    expect(after.hourly).toEqual([{ date: '2026-11-10', hour: 14, ad: 0, inapp: 4400 * M, paid: 0 }]);
    const refunded = applyTransaction(after, { ...tx, id: 'r', type: 'refund', amountKrwMicros: -4400 * M });
    expect(refunded.daily[0].inapp.apple).toBe(0);
    expect(refunded.refundsThisMonth).toHaveLength(1);
    expect(refunded.transactions.map((t) => t.id)).toEqual(['r', 't']);
  });
});

describe('comparison bars and app detail', () => {
  it('shows every day of the month with last month aligned by day number', () => {
    const r = raw({ daily: [daily('2026-10-31', 'a', { ad: 5 }), daily('2026-10-10', 'a', { ad: 7 }), daily('2026-11-10', 'a', { ad: 1 }, 'estimated')] });
    const b = buildDashboard(r, 'month', NOW).buckets;
    expect(b).toHaveLength(30); // November
    expect(b[9]).toMatchObject({ key: '2026-11-10', partial: true, prev: 7 * M, prevTitle: '10/10' });
    expect(b[10]).toMatchObject({ future: true, ad: 0 });
    expect(b[29].prevTitle).toBe('10/30');
    expect(b[0].prev).toBeNull(); // no doc for 10/1
  });

  it('aligns 7d with the previous 7 days', () => {
    const r = raw({ daily: [daily('2026-10-28', 'a', { ad: 3 })] });
    const b = buildDashboard(r, '7d', NOW).buckets;
    expect(b[0]).toMatchObject({ key: '2026-11-04', prev: 3 * M, prevTitle: '10/28' });
  });

  it('shows yesterday as a full hourly day compared with the day before', () => {
    const r = raw({
      daily: [daily('2026-11-09', 'a', { ad: 10, inapp: 2 }), daily('2026-11-08', 'a', { ad: 8 }), daily('2026-11-10', 'a', { ad: 99 }, 'estimated')],
      hourly: [
        { date: '2026-11-09', hour: 20, ad: 4 * M, inapp: 0, paid: 0 },
        { date: '2026-11-08', hour: 20, ad: 3 * M, inapp: 0, paid: 0 },
      ],
    });
    const d = buildDashboard(r, 'yesterday', NOW);
    expect(d.totals).toEqual({ ad: 10 * M, inapp: 2 * M, paid: 0 });
    expect(d.previousTotal).toBe(8 * M); // full day, no proration
    expect(d.compareLabel).toBe('그제 대비');
    expect(d.hasEstimated).toBe(false);
    expect(d.buckets).toHaveLength(24);
    expect(d.buckets.some((b) => b.future || b.partial)).toBe(false);
    expect(d.buckets[20]).toMatchObject({ key: '2026-11-09_20', ad: 4 * M, prev: 3 * M, prevTitle: '그제 20:00–21:00', status: 'final' });
  });

  it('has no grey bars for today when yesterday has no hourly docs', () => {
    const b = buildDashboard(raw({}), 'today', NOW).buckets;
    expect(b.every((x) => x.prev === null)).toBe(true);
  });

  it('sums ad units and store split per app over the period', () => {
    const unit = (req: number, imp: number, won: number) => ({ name: '홈 배너', platform: 'android' as const, format: 'banner', requests: req, matchedRequests: req, impressions: imp, clicks: 0, earningsMicros: won * M });
    const d1 = daily('2026-11-09', 'a', { ad: 10, inapp: 4, paid: 2 });
    const d2 = daily('2026-11-10', 'a', { ad: 20 }, 'estimated');
    d1.ad.units = { u1: unit(100, 80, 10) };
    d2.ad.units = { u1: unit(50, 40, 15), u2: unit(10, 5, 5) };
    const row = buildDashboard(raw({ daily: [d1, d2] }), '7d', NOW).appRows[0];
    expect(row.adUnits.map((u) => [u.key, u.requests, u.impressions, u.earningsMicros])).toEqual([
      ['u1', 150, 120, 25 * M],
      ['u2', 10, 5, 5 * M],
    ]);
    expect(row.stores).toEqual({ google: 4 * M, apple: 2 * M });
  });

  it('gives each app the comparison-window numbers, prorating the day that matches today', () => {
    const unit = (req: number, won: number) => ({ name: '홈 배너', platform: 'android' as const, format: 'banner', requests: req, matchedRequests: req, impressions: req, clicks: 0, earningsMicros: won * M });
    const d9 = daily('2026-11-09', 'a', { ad: 48, inapp: 24 });
    d9.ad.units = { u1: unit(480, 48) };
    const d8 = daily('2026-11-08', 'a', { ad: 10 });
    d8.ad.units = { u1: unit(100, 10) };
    const today = daily('2026-11-10', 'a', { ad: 5 }, 'estimated');
    const r = raw({ daily: [d8, d9, today] });

    // 14:30 KST = 14.5/24 of yesterday counts.
    const t = buildDashboard(r, 'today', NOW).appRows[0].prev!;
    expect(t.ad).toBe(29 * M);
    expect(t.stores).toEqual({ google: 14.5 * M, apple: 0 });
    expect(t.adUnits.map((u) => [u.key, u.requests, u.earningsMicros])).toEqual([['u1', 290, 29 * M]]);

    // Yesterday vs the day before: whole days.
    const y = buildDashboard(r, 'yesterday', NOW).appRows[0].prev!;
    expect(y.ad).toBe(10 * M);
    expect(y.adUnits[0].requests).toBe(100);
  });

  it('has no comparison numbers for an app without data in the previous window', () => {
    const r = raw({ daily: [daily('2026-11-10', 'a', { ad: 5 }, 'estimated')] });
    expect(buildDashboard(r, 'today', NOW).appRows[0].prev).toBeNull();
  });
});
