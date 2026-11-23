// Pure money math for Play orders. gross = total − tax (CLAUDE.md §3-4).
import { moneyToMicros } from '../shared/money';
import type { Order } from './api';

export function orderAmounts(order: Order) {
  const currency = order.total?.currencyCode ?? order.developerRevenueInBuyerCurrency?.currencyCode ?? 'KRW';
  return {
    currency,
    grossMicros: moneyToMicros(order.total) - moneyToMicros(order.tax),
    netMicros: moneyToMicros(order.developerRevenueInBuyerCurrency),
  };
}

/** Total refunded so far for an order, tax excluded (positive number). */
export function refundedGrossMicros(order: Order): number {
  const h = order.orderHistory;
  if (h?.refundEvent?.refundDetails) {
    const d = h.refundEvent.refundDetails;
    return Math.abs(moneyToMicros(d.total) - moneyToMicros(d.tax));
  }
  let sum = 0;
  for (const p of h?.partialRefundEvents ?? []) {
    if (p.state && p.state !== 'PROCESSED_SUCCESSFULLY') continue;
    sum += Math.abs(moneyToMicros(p.refundDetails?.total) - moneyToMicros(p.refundDetails?.tax));
  }
  return sum;
}
