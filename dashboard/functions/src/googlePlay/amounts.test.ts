import { describe, expect, it } from 'vitest';
import { orderAmounts, refundedGrossMicros } from './amounts';

describe('orderAmounts', () => {
  it('uses total minus tax as gross and keeps developer revenue as net', () => {
    const a = orderAmounts({
      orderId: 'GPA.1',
      total: { currencyCode: 'KRW', units: '4400' },
      tax: { currencyCode: 'KRW', units: '400' },
      developerRevenueInBuyerCurrency: { currencyCode: 'KRW', units: '2800' },
    });
    expect(a).toEqual({ currency: 'KRW', grossMicros: 4_000_000_000, netMicros: 2_800_000_000 });
  });
});

describe('refundedGrossMicros', () => {
  it('reads a full refund without tax', () => {
    expect(refundedGrossMicros({ orderId: 'x', orderHistory: { refundEvent: { refundDetails: { total: { units: '4400' }, tax: { units: '400' } } } } })).toBe(4_000_000_000);
  });
  it('sums processed partial refunds only', () => {
    expect(
      refundedGrossMicros({
        orderId: 'x',
        orderHistory: {
          partialRefundEvents: [
            { state: 'PROCESSED_SUCCESSFULLY', refundDetails: { total: { units: '1100' }, tax: { units: '100' } } },
            { state: 'PENDING', refundDetails: { total: { units: '999' } } },
          ],
        },
      }),
    ).toBe(1_000_000_000);
  });
  it('is zero when nothing was refunded yet', () => {
    expect(refundedGrossMicros({ orderId: 'x' })).toBe(0);
  });
});
