import { describe, expect, it } from 'vitest';
import { parseCsv } from '../shared/files';
import { parsePlaySales } from './salesReport';

const HEADER = 'Order Number,Order Charged Date,Order Charged Timestamp,Financial Status,Device Model,Product Title,Package ID,Product Type,SKU ID,Currency of Sale,Item Price,Taxes Collected,Charged Amount,City of Buyer,State of Buyer,Postcode of Buyer,Country of Buyer,Base Plan or Purchase Option ID,Offer ID,Group ID,First USD 1M Eligible,Promotion ID,Coupon Value,Discount Rate,Featured Products ID,Price Experiment ID,Sales Channel';
// 2026-11-20 15:30 UTC = 2026-11-21 00:30 KST
const T1 = Date.UTC(2026, 10, 20, 15, 30) / 1000;
// 2026-11-20 14:00 UTC = 2026-11-20 23:00 KST
const T0 = Date.UTC(2026, 10, 20, 14, 0) / 1000;

const line = (ts: number, status: string, pkg: string, type: string, cur: string, price: string, tax: string, charged: string) =>
  `GPA.1,2026-11-20,${ts},${status},pixel,"Liquid Frame, Pro",${pkg},${type},sku,${cur},${price},${tax},${charged},,,,KR,,,,,,,,,,`;

describe('parsePlaySales', () => {
  const rows = parseCsv([
    HEADER,
    line(T0, 'Charged', 'com.hnh.liquidframe', 'Paid app', 'KRW', '3000', '300', '3300'),
    line(T1, 'charged', 'com.hnh.timer', 'Subscription', 'USD', '1.99', '0.20', '2.19'),
    line(T1, 'Refund', 'com.hnh.timer', 'Subscription', 'USD', '-1.99', '-0.20', '-2.19'),
    line(T1, 'Partial refund', 'com.hnh.timer', 'One-time product', 'USD', '0.50', '', ''),
    line(T1, 'Cancelled', 'com.hnh.timer', 'Subscription', 'USD', '1.99', '', ''),
    line(T1, 'Charged', 'com.hnh.timer', 'One-time product', 'EUR', '', '0.19', '1.18'),
  ].join('\n'));
  const p = parsePlaySales(rows);

  it('uses tax-excluded item price, KST dates and the product type', () => {
    expect(p.sales[0]).toEqual({ date: '2026-11-20', pkg: 'com.hnh.liquidframe', kind: 'paid', currency: 'KRW', grossMicros: 3_000_000_000 });
    expect(p.sales[1]).toMatchObject({ date: '2026-11-21', kind: 'inapp', currency: 'USD', grossMicros: 1_990_000 });
  });
  it('makes refunds negative whatever sign the file uses', () => {
    expect(p.sales[2].grossMicros).toBe(-1_990_000);
    expect(p.sales[3].grossMicros).toBe(-500_000);
  });
  it('falls back to charged − tax and skips unknown statuses', () => {
    expect(p.sales[4]).toMatchObject({ currency: 'EUR', grossMicros: 990_000 });
    expect(p.sales).toHaveLength(5);
    expect(p.skippedStatuses).toEqual({ Cancelled: 1 });
  });
  it('reports the newest order time', () => {
    expect(p.latestAt?.getTime()).toBe(T1 * 1000);
  });
  it('fails loudly without required columns', () => {
    expect(() => parsePlaySales([['Order Number', 'Item Price']])).toThrow(/column missing/);
  });
});
