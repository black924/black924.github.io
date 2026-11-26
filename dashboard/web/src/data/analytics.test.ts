import { describe, expect, it } from 'vitest';
import { changeAt, countryName, fillDays, mockAnalytics, toDaily, toRealtime } from './analytics';

const p = (date: string, dau: number, mau = 0) => ({ date, dau, mau, newUsers: 0 });

describe('analytics helpers', () => {
  it('fills missing days with zeros up to the last date', () => {
    const out = fillDays([p('2026-11-23', 5), p('2026-11-25', 7)], '2026-11-25', 3);
    expect(out.map((x) => [x.date, x.dau])).toEqual([['2026-11-23', 5], ['2026-11-24', 0], ['2026-11-25', 7]]);
  });

  it('computes the change against 7 days earlier', () => {
    const s = [p('2026-11-18', 100, 1000), p('2026-11-25', 120, 900)];
    expect(changeAt(s, '2026-11-25', 'dau')).toEqual({ value: 120, base: 100, change: 20 });
    expect(changeAt(s, '2026-11-25', 'mau').change).toBeCloseTo(-10);
    expect(changeAt([p('2026-11-25', 3)], '2026-11-25', 'dau').change).toBeNull();
  });

  it('shows Korean country names', () => {
    expect(countryName('KR')).toBe('대한민국');
    expect(countryName('(not set)')).toBe('알 수 없음');
  });

  it('maps documents defensively', () => {
    const rt = toRealtime({ activeUsers: 3, perMinute: [1, 2], apps: [{ appId: 'a', users: 3, countries: [{ name: 'KR', users: 3 }] }, { bad: 1 }], state: 'ok' });
    expect(rt.perMinute).toHaveLength(30);
    expect(rt.apps).toHaveLength(1);
    expect(rt.error).toBeNull();
    expect(toRealtime({ state: 'error', error: 'x' }).error).toBe('x');
    const d = toDaily({ total: [p('2026-11-25', 1)], apps: { a: [p('2026-11-25', 1)] }, names: { a: 'A' } });
    expect(d.apps.a[0].dau).toBe(1);
    expect(d.names.a).toBe('A');
  });

  it('builds mock data with 60 days per app', () => {
    const m = mockAnalytics('2026-11-26');
    expect(m.daily.total).toHaveLength(60);
    expect(m.daily.total[59].date).toBe('2026-11-26');
  });
});
