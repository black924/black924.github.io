import { describe, expect, it } from 'vitest';
import { classify, decodeNotification, orderDocId } from './notification';
import { moneyToMicros, toKrwMicros } from '../shared/money';
import { parseFrankfurter } from '../fx/frankfurter';

const base = { version: '1.0', packageName: 'com.hnh.timer', eventTimeMillis: '1762750000000' };

describe('classify', () => {
  it('treats purchase, renew and recover as charges; other subscription events are ignored', () => {
    for (const t of [1, 2, 4]) {
      expect(classify({ ...base, subscriptionNotification: { notificationType: t, purchaseToken: 'tok' } }).kind).toBe('subscriptionCharge');
    }
    for (const t of [3, 5, 7, 12, 13]) {
      expect(classify({ ...base, subscriptionNotification: { notificationType: t, purchaseToken: 'tok' } }).kind).toBe('ignore');
    }
  });
  it('handles one-time purchases, refunds and test pings', () => {
    expect(classify({ ...base, oneTimeProductNotification: { notificationType: 1, purchaseToken: 't', sku: 'remit.premium' } })).toEqual({
      kind: 'inappCharge', token: 't', sku: 'remit.premium',
    });
    expect(classify({ ...base, oneTimeProductNotification: { notificationType: 2, purchaseToken: 't', sku: 's' } }).kind).toBe('ignore');
    expect(classify({ ...base, voidedPurchaseNotification: { purchaseToken: 't', orderId: 'GPA.1', productType: 1, refundType: 2 } })).toEqual({
      kind: 'refund', orderId: 'GPA.1', token: 't', productType: 'subscription', partial: true,
    });
    expect(classify({ ...base, testNotification: { version: '1.0' } }).kind).toBe('test');
  });
  it('rejects junk', () => {
    expect(() => decodeNotification({ foo: 1 })).toThrow();
  });
  it('builds safe order ids', () => {
    expect(orderDocId('gp', 'GPA.3333-4444-5555-66666..0')).toBe('gp_GPA.3333-4444-5555-66666..0');
    expect(orderDocId('gp', 'a/b')).toBe('gp_a_b');
  });
});

describe('money', () => {
  it('converts Money to micros with signs and rounding', () => {
    expect(moneyToMicros({ currencyCode: 'USD', units: '12', nanos: 990000000 })).toBe(12_990_000);
    expect(moneyToMicros({ units: '-1', nanos: -750000000 })).toBe(-1_750_000);
    expect(moneyToMicros({ units: '0', nanos: 1500 })).toBe(2); // 1.5 micros → 2
    expect(moneyToMicros({ units: '4400' })).toBe(4_400_000_000);
    expect(moneyToMicros(undefined)).toBe(0);
  });
  it('converts to KRW exactly with integer math', () => {
    expect(toKrwMicros(2_990_000, 1350.63)).toBe(4_038_383_700); // $2.99 → ₩4,038.3837
    expect(toKrwMicros(-1_000_000, 1350.63)).toBe(-1_350_630_000);
    expect(toKrwMicros(1, 0.0000005)).toBe(0);
    expect(() => toKrwMicros(1, 0)).toThrow();
  });
});

describe('parseFrankfurter', () => {
  it('derives KRW per unit through USD cross rates', () => {
    const fx = parseFrankfurter([
      { date: '2026-11-10', base: 'USD', quote: 'KRW', rate: 1350.63 },
      { date: '2026-11-10', base: 'USD', quote: 'JPY', rate: 155.0 },
      { date: '2026-11-10', base: 'USD', quote: 'EUR', rate: 0.9 },
    ]);
    expect(fx.rateDate).toBe('2026-11-10');
    expect(fx.krwPer.USD).toBe(1350.63);
    expect(fx.krwPer.JPY).toBeCloseTo(8.713742, 6);
    expect(fx.krwPer.EUR).toBeCloseTo(1500.7, 6);
    expect(fx.krwPer.KRW).toBe(1);
  });
  it('fails without a KRW quote', () => {
    expect(() => parseFrankfurter([{ base: 'USD', quote: 'JPY', rate: 150 }])).toThrow();
  });
});
