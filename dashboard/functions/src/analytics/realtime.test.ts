import { describe, expect, it, vi } from 'vitest';

vi.mock('../shared/firestore', () => ({ db: {} }));

import { AnalyticsError, analyticsErrorMessage, streamAppMap, toStream, type StreamApp } from './ga4';
import { perMinute, realtimeApps, topCounts, total } from './realtime';
import { appSeries, isoDate, totalSeries } from './daily';

const row = (dims: string[], ...vals: number[]) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: vals.map((v) => ({ value: String(v) })),
});

const streams = new Map<string, StreamApp>([
  ['11', { appId: 'noiselog', platform: 'android', name: 'Noise Android' }],
  ['22', { appId: 'noiselog', platform: 'ios', name: 'Noise iOS' }],
]);

describe('GA4 streams', () => {
  it('reads platform and app key from a data stream', () => {
    expect(toStream({ name: 'properties/1/dataStreams/11', displayName: 'A', androidAppStreamData: { packageName: 'com.a' } })).toEqual({
      id: '11', name: 'A', platform: 'android', appKey: 'com.a',
    });
    expect(toStream({ name: 'properties/1/dataStreams/22', iosAppStreamData: { bundleId: 'com.b' } }).platform).toBe('ios');
  });

  it('maps streams to dashboard apps by package / bundle id per platform', () => {
    const m = streamAppMap(
      [
        { id: '11', name: 'A', platform: 'android', appKey: 'com.a' },
        { id: '22', name: 'B', platform: 'ios', appKey: 'com.a' },
        { id: '33', name: 'C', platform: 'ios', appKey: 'com.unknown' },
      ],
      [{ id: 'app1', playPackage: 'com.a', appStoreBundleId: 'com.a' }],
    );
    expect(m.get('11')?.appId).toBe('app1');
    expect(m.get('22')?.appId).toBe('app1');
    expect(m.get('33')?.appId).toBe('ga_33');
  });

  it('gives a permission hint for 403 only', () => {
    expect(analyticsErrorMessage(new AnalyticsError(403, 'x'))).toContain('뷰어');
    expect(analyticsErrorMessage(new Error('x'))).not.toContain('뷰어');
  });
});

describe('GA4 realtime parsing', () => {
  it('reads the total of a dimensionless report', () => {
    expect(total({ rows: [row([], 17)] })).toBe(17);
    expect(total({})).toBe(0);
  });

  it('maps minutesAgo labels to a 30-slot array', () => {
    const m = perMinute({ rows: [row(['00'], 3), row(['05'], 2), row(['29'], 1), row(['30'], 9), row(['x'], 4)] });
    expect(m).toHaveLength(30);
    expect([m[0], m[5], m[29]]).toEqual([3, 2, 1]);
    expect(m.reduce((a, b) => a + b, 0)).toBe(6);
  });

  it('sorts counts, drops zeros and limits', () => {
    expect(topCounts([['KR', 2], ['US', 5], ['JP', 0], ['DE', 1]], 2)).toEqual([{ name: 'US', users: 5 }, { name: 'KR', users: 2 }]);
  });

  it('groups stream × country rows into apps', () => {
    const apps = realtimeApps(
      { rows: [row(['11', 'South Korea'], 4), row(['22', 'South Korea'], 2), row(['22', 'Japan'], 1), row(['99', 'United States'], 3)] },
      streams,
    );
    expect(apps[0]).toEqual({
      appId: 'noiselog', name: 'Noise Android', users: 7, android: 4, ios: 3,
      countries: [{ name: 'South Korea', users: 6 }, { name: 'Japan', users: 1 }],
    });
    expect(apps[1].appId).toBe('ga_99');
  });
});

describe('GA4 daily parsing', () => {
  it('converts YYYYMMDD', () => {
    expect(isoDate('20261125')).toBe('2026-11-25');
    expect(isoDate('(other)')).toBeNull();
  });

  it('sorts the total series by date', () => {
    const s = totalSeries({ rows: [row(['20261125'], 10, 100, 2), row(['20261124'], 8, 90, 1)] });
    expect(s.map((p) => p.date)).toEqual(['2026-11-24', '2026-11-25']);
    expect(s[1]).toEqual({ date: '2026-11-25', dau: 10, mau: 100, newUsers: 2 });
  });

  it('sums an app\'s streams per day', () => {
    const { series, names } = appSeries({ rows: [row(['20261125', '11'], 5, 50, 1), row(['20261125', '22'], 3, 20, 0)] }, streams);
    expect(series.noiselog).toEqual([{ date: '2026-11-25', dau: 8, mau: 70, newUsers: 1 }]);
    expect(names.noiselog).toBe('Noise Android');
  });
});

import { propertyIds } from './ga4';
import { mergeRealtime } from './realtime';
import { mergeDaily } from './daily';

describe('several GA4 properties', () => {
  it('reads property ids from the array and the comma separated string', () => {
    expect(propertyIds({ ga4PropertyIds: ['1', 'properties/2', 'x'], ga4PropertyId: '3, 1' })).toEqual(['1', '2', '3']);
    expect(propertyIds({})).toEqual([]);
  });

  it('sums realtime parts', () => {
    const a = { activeUsers: 2, perMinute: [1, 1], apps: [{ appId: 'x', name: 'X', users: 2, android: 2, ios: 0, countries: [{ name: 'KR', users: 2 }] }], countries: [['KR', 2]] as [string, number][] };
    const b = { activeUsers: 3, perMinute: [0, 2], apps: [{ appId: 'y', name: 'Y', users: 3, android: 0, ios: 3, countries: [{ name: 'JP', users: 3 }] }], countries: [['KR', 1], ['JP', 2]] as [string, number][] };
    const m = mergeRealtime([a, b]);
    expect(m.activeUsers).toBe(5);
    expect(m.perMinute.slice(0, 2)).toEqual([1, 3]);
    expect(m.apps.map((x) => x.appId)).toEqual(['y', 'x']);
    expect(m.countries).toEqual([{ name: 'KR', users: 3 }, { name: 'JP', users: 2 }]);
  });

  it('sums daily totals per date', () => {
    const d = (date: string, dau: number) => ({ date, dau, mau: dau * 10, newUsers: 0 });
    const m = mergeDaily([
      { timeZone: 'Asia/Seoul', total: [d('2026-11-25', 5)], series: { x: [d('2026-11-25', 5)] }, names: {} },
      { timeZone: 'Asia/Seoul', total: [d('2026-11-24', 1), d('2026-11-25', 2)], series: { y: [d('2026-11-25', 2)] }, names: { y: 'Y' } },
    ]);
    expect(m.total).toEqual([d('2026-11-24', 1), { date: '2026-11-25', dau: 7, mau: 70, newUsers: 0 }]);
    expect(Object.keys(m.apps)).toEqual(['x', 'y']);
    expect(m.timeZone).toBe('Asia/Seoul');
  });
});
