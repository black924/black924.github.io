import { describe, expect, it, vi } from 'vitest';

vi.mock('../shared/firestore', () => ({ db: {} }));
vi.mock('../fx/rates', () => ({ krwPerUnit: vi.fn() }));

import { bucketName, completeDates, salesObjects, toDayAmounts } from './googlePlay';

describe('google play reconcile helpers', () => {
  it('accepts a bare bucket id or the gs:// URI', () => {
    expect(bucketName('gs://pubsite_prod_rev_0123/')).toBe('pubsite_prod_rev_0123');
    expect(bucketName(' pubsite_prod_rev_0123 ')).toBe('pubsite_prod_rev_0123');
  });

  it('lists every month file in the window', () => {
    expect(salesObjects('2026-10-28', '2026-11-03')).toEqual(['sales/salesreport_202610.zip', 'sales/salesreport_202611.zip']);
  });

  it('only treats days before the newest order as complete', () => {
    const latest = new Date(Date.UTC(2026, 10, 18, 3)); // 2026-11-18 12:00 KST
    expect(completeDates('2026-11-15', '2026-11-22', latest)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17']);
    expect(completeDates('2026-11-15', '2026-11-22', null)).toEqual([]);
  });

  it('converts per date and app, skipping dates outside the window and unknown currencies', async () => {
    const rate = vi.fn(async (c: string) => {
      if (c === 'USD') return 1400;
      if (c === 'KRW') return 1;
      throw new Error('none');
    });
    const { byDate, missingFx } = await toDayAmounts(
      [
        { date: '2026-11-16', pkg: 'com.hnh.liquidframe', kind: 'paid', currency: 'KRW', grossMicros: 3_000_000_000 },
        { date: '2026-11-16', pkg: 'com.hnh.timer', kind: 'inapp', currency: 'USD', grossMicros: 1_990_000 },
        { date: '2026-11-16', pkg: 'com.hnh.timer', kind: 'inapp', currency: 'USD', grossMicros: -1_990_000 },
        { date: '2026-11-16', pkg: 'com.hnh.timer', kind: 'inapp', currency: 'XTS', grossMicros: 1 },
        { date: '2026-11-18', pkg: 'com.hnh.timer', kind: 'inapp', currency: 'USD', grossMicros: 1_000_000 },
      ],
      new Set(['2026-11-16']),
      (pkg) => ({ 'com.hnh.liquidframe': 'liquidframe', 'com.hnh.timer': 'remit' })[pkg] ?? `gp_${pkg}`,
      rate,
    );
    expect(missingFx).toEqual(['XTS']);
    expect([...byDate.keys()]).toEqual(['2026-11-16']);
    expect(byDate.get('2026-11-16')!.get('liquidframe')).toEqual({ inapp: 0, paid: 3_000_000_000 });
    expect(byDate.get('2026-11-16')!.get('remit')).toEqual({ inapp: 0, paid: 0 });
    expect(rate).toHaveBeenCalledTimes(3); // cached per currency and date
  });
});
