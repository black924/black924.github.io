import { describe, expect, it, vi } from 'vitest';

vi.mock('../shared/firestore', () => ({ db: {} }));
vi.mock('../fx/rates', () => ({ krwPerUnit: vi.fn() }));

import { AscError } from '../appStore/connect';
import { appStoreErrorMessage, toAppAmounts } from './appStore';

describe('toAppAmounts', () => {
  it('converts each currency to KRW and sums per app', async () => {
    const rates: Record<string, number> = { USD: 1400, KRW: 1 };
    const rate = async (c: string) => {
      if (!(c in rates)) throw new Error('no rate');
      return rates[c];
    };
    const { byApp, missingFx } = await toAppAmounts(
      [
        { appSku: 'NOISE', kind: 'inapp', currency: 'USD', netMicros: 1_700_000, grossMicros: 2_000_000 },
        { appSku: 'NOISE', kind: 'inapp', currency: 'KRW', netMicros: 3_080_000_000, grossMicros: 4_400_000_000 },
        { appSku: 'NOISE', kind: 'paid', currency: 'XTS', netMicros: 1, grossMicros: 1 },
        { appSku: 'OTHER', kind: 'paid', currency: 'USD', netMicros: 700_000, grossMicros: 1_000_000 },
      ],
      '2026-11-20',
      (sku) => (sku === 'NOISE' ? 'noiselog' : `as_sku_${sku}`),
      rate,
    );
    expect(missingFx).toEqual(['XTS']);
    expect(byApp.get('noiselog')).toEqual({ inapp: 2_800_000_000 + 4_400_000_000, paid: 0, inappNet: 2_380_000_000 + 3_080_000_000, paidNet: 0 });
    expect(byApp.get('as_sku_OTHER')).toEqual({ inapp: 0, paid: 1_400_000_000, inappNet: 0, paidNet: 980_000_000 });
  });
});

describe('appStoreErrorMessage', () => {
  it('points at the API key on 401/403', () => {
    expect(appStoreErrorMessage(new AscError(401, 'x'))).toMatch(/API 키/);
    expect(appStoreErrorMessage(new Error('boom'))).toMatch(/다시 시도/);
  });
});
