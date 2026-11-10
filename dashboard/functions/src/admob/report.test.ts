import { describe, expect, it } from 'vitest';
import { aggregateDaily, classifySource, mapApps, parseMediationReport, planHourlyAd } from './report';
import { parseMicros } from '../shared/money';
import { addDays, fromCompactDate, kstDateKey } from '../shared/kst';

const row = (date: string, app: string, source: [string, string], micros: Record<string, unknown>) => ({
  row: {
    dimensionValues: { DATE: { value: date }, APP: { value: app, displayLabel: 'x' }, AD_SOURCE: { value: source[0], displayLabel: source[1] } },
    metricValues: { ESTIMATED_EARNINGS: micros },
  },
});

describe('parseMicros', () => {
  it('parses int64 strings exactly', () => {
    expect(parseMicros('1324746')).toBe(1324746);
    expect(parseMicros('-5000000')).toBe(-5000000);
    expect(parseMicros(42)).toBe(42);
  });
  it('rounds decimal strings and rejects junk', () => {
    expect(parseMicros('10.6')).toBe(11);
    expect(() => parseMicros('abc')).toThrow();
    expect(() => parseMicros('99999999999999999999')).toThrow();
  });
});

describe('kst helpers', () => {
  it('converts compact dates and KST keys', () => {
    expect(fromCompactDate('20261110')).toBe('2026-11-10');
    expect(() => fromCompactDate('2026-11-10')).toThrow();
    expect(kstDateKey(new Date('2026-11-09T15:00:00Z'))).toBe('2026-11-10');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
});

describe('parseMediationReport', () => {
  it('reads header currency and rows, accepting either metric wrapper', () => {
    const body = [
      { header: { localizationSettings: { currencyCode: 'KRW' } } },
      row('20261110', 'ca-app-pub-1~111', ['5450213213286189855', 'AdMob Network'], { microsValue: '1000000' }),
      row('20261110', 'ca-app-pub-1~111', ['123', 'Unity Ads'], { decimal_value: '250000' }),
      { footer: { matchingRowCount: 2 } },
    ];
    const r = parseMediationReport(body);
    expect(r.currency).toBe('KRW');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ date: '2026-11-10', admobAppId: 'ca-app-pub-1~111', micros: 1000000 });
    expect(r.rows[1].micros).toBe(250000);
  });
  it('rejects a non-array body', () => {
    expect(() => parseMediationReport({ error: 'x' })).toThrow();
  });
});

describe('classifySource', () => {
  it('buckets AdMob, Unity and the rest', () => {
    expect(classifySource('5450213213286189855')).toBe('admob');
    expect(classifySource('1', 'AdMob Network')).toBe('admob');
    expect(classifySource('2', 'Unity Ads')).toBe('unity');
    expect(classifySource('3', 'Meta Audience Network')).toBe('other');
  });
});

describe('mapApps + aggregateDaily', () => {
  const admobApps = [
    { appId: 'ca-app-pub-1~111', platform: 'ANDROID', storeId: 'com.menew.noiseanalyzer', name: '층소일지' },
    { appId: 'ca-app-pub-1~222', platform: 'IOS', storeId: '6823575453', name: '층소일지' },
    { appId: 'ca-app-pub-1~333', platform: 'ANDROID', name: 'Unlinked' },
  ];
  const ours = [{ id: 'noiselog', playPackage: 'com.menew.noiseanalyzer', appStoreAppId: '6823575453' }];

  it('merges Android and iOS AdMob apps into one of our apps; keeps unmatched ones visible', () => {
    const { map, unmatched } = mapApps(admobApps, ours);
    expect(map.get('ca-app-pub-1~111')).toBe('noiselog');
    expect(map.get('ca-app-pub-1~222')).toBe('noiselog');
    expect(unmatched.map((u) => u.ourId)).toEqual(['admob_333']);

    const rows = parseMediationReport([
      row('20261110', 'ca-app-pub-1~111', ['5450213213286189855', 'AdMob Network'], { microsValue: '700' }),
      row('20261110', 'ca-app-pub-1~222', ['9', 'Unity Ads'], { microsValue: '300' }),
      row('20261109', 'ca-app-pub-1~333', ['8', 'Other'], { microsValue: '50' }),
    ]).rows;
    const daily = aggregateDaily(rows, map);
    expect(daily.get('2026-11-10_noiselog')).toEqual({
      date: '2026-11-10', appId: 'noiselog', totalMicros: 1000, bySource: { admob: 700, unity: 300, other: 0 },
    });
    expect(daily.get('2026-11-09_admob_333')?.bySource.other).toBe(50);
  });
});

describe('planHourlyAd', () => {
  it('spreads the first total of the day over elapsed hours, summing exactly', () => {
    const { increments, base } = planHourlyAd(undefined, '2026-11-10', 3, 1001);
    expect(increments.map((i) => i.hour)).toEqual([0, 1, 2, 3]);
    expect(increments.reduce((a, i) => a + i.micros, 0)).toBe(1001);
    expect(base).toEqual({ date: '2026-11-10', totalMicros: 1001 });
  });
  it('puts only the growth into the current hour', () => {
    const { increments } = planHourlyAd({ date: '2026-11-10', totalMicros: 1000 }, '2026-11-10', 14, 1600);
    expect(increments).toEqual([{ hour: 14, micros: 600 }]);
  });
  it('ignores decreases and resets on a new day', () => {
    expect(planHourlyAd({ date: '2026-11-10', totalMicros: 1000 }, '2026-11-10', 14, 900).increments).toEqual([]);
    expect(planHourlyAd({ date: '2026-11-09', totalMicros: 5000 }, '2026-11-10', 0, 40).increments).toEqual([{ hour: 0, micros: 40 }]);
  });
});

import { loginHint } from './oauth';

describe('loginHint', () => {
  it('passes plain emails and drops anything else', () => {
    expect(loginHint('owner.second@example.com')).toBe('owner.second@example.com');
    expect(loginHint('not an email')).toBeUndefined();
    expect(loginHint(['a@b.com'])).toBeUndefined();
    expect(loginHint(undefined)).toBeUndefined();
  });
});

import { historyStart } from '../shared/kst';

describe('historyStart', () => {
  it('covers last month and the previous 7-day window', () => {
    expect(historyStart('2026-11-10')).toBe('2026-10-01');
    expect(historyStart('2027-01-05')).toBe('2026-12-01');
    expect(historyStart('2026-03-03')).toBe('2026-02-01');
  });
});

import { adUnitKey, groupAdUnits, parseAdUnitReport } from './report';

describe('ad unit report', () => {
  const unitRow = (date: string, app: string, unit: string, format: string, m: Record<string, string>) => ({
    row: {
      dimensionValues: { DATE: { value: date }, APP: { value: app }, AD_UNIT: { value: unit, displayLabel: '홈 배너' }, FORMAT: { value: format } },
      metricValues: {
        AD_REQUESTS: { integerValue: m.req },
        MATCHED_REQUESTS: { integerValue: m.matched },
        IMPRESSIONS: { integerValue: m.imp },
        CLICKS: { integerValue: '1' },
        ESTIMATED_EARNINGS: { microsValue: m.earn },
      },
    },
  });

  it('parses counts and groups by daily doc and ad unit', () => {
    const rows = parseAdUnitReport([
      { header: {} },
      unitRow('20261110', 'ca-app-pub-1~111', 'ca-app-pub-1/999', 'banner', { req: '100', matched: '90', imp: '80', earn: '500000' }),
      unitRow('20261110', 'ca-app-pub-1~222', 'ca-app-pub-1/888', 'interstitial', { req: '10', matched: '9', imp: '5', earn: '700000' }),
      { footer: {} },
    ]);
    expect(rows[0]).toMatchObject({ name: '홈 배너', format: 'banner', requests: 100, matchedRequests: 90, impressions: 80, earningsMicros: 500000 });
    const map = new Map([['ca-app-pub-1~111', 'noiselog'], ['ca-app-pub-1~222', 'noiselog']]);
    const platforms = new Map([['ca-app-pub-1~111', 'android' as const], ['ca-app-pub-1~222', 'ios' as const]]);
    const g = groupAdUnits(rows, map, platforms).get('2026-11-10_noiselog')!;
    expect(Object.keys(g).sort()).toEqual(['888', '999']);
    expect(g['999']).toMatchObject({ impressions: 80, platform: 'android' });
    expect(g['888'].platform).toBe('ios');
  });

  it('makes Firestore-safe keys', () => {
    expect(adUnitKey('ca-app-pub-123~/4567')).toBe('4567');
    expect(adUnitKey('weird~id')).toBe('weird_id');
  });
});
