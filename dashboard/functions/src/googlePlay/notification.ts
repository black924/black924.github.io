// Pure decoding/classification of Play Real-time developer notifications.
// Reference: https://developer.android.com/google/play/billing/rtdn-reference

export interface DeveloperNotification {
  version?: string;
  packageName: string;
  eventTimeMillis: string | number;
  subscriptionNotification?: { version?: string; notificationType: number; purchaseToken: string };
  oneTimeProductNotification?: { version?: string; notificationType: number; purchaseToken: string; sku: string };
  voidedPurchaseNotification?: { purchaseToken: string; orderId: string; productType: number; refundType: number };
  pendingRefundReviewNotification?: { orderId: string };
  testNotification?: { version?: string };
}

export type RtdnAction =
  | { kind: 'test' }
  | { kind: 'subscriptionCharge'; token: string; notificationType: number }
  | { kind: 'inappCharge'; token: string; sku: string }
  | { kind: 'refund'; orderId: string; token: string; productType: 'subscription' | 'inapp'; partial: boolean }
  | { kind: 'ignore'; reason: string };

// Subscription notification types that mean money was charged.
export const SUB_CHARGE_TYPES: Record<number, string> = { 1: 'SUBSCRIPTION_RECOVERED', 2: 'SUBSCRIPTION_RENEWED', 4: 'SUBSCRIPTION_PURCHASED' };
export const ONE_TIME_PRODUCT_PURCHASED = 1;

export function decodeNotification(json: unknown): DeveloperNotification {
  const n = json as DeveloperNotification;
  if (!n || typeof n !== 'object' || typeof n.packageName !== 'string') throw new Error('Not a DeveloperNotification');
  return n;
}

export function classify(n: DeveloperNotification): RtdnAction {
  if (n.testNotification) return { kind: 'test' };
  if (n.subscriptionNotification) {
    const { notificationType, purchaseToken } = n.subscriptionNotification;
    return SUB_CHARGE_TYPES[notificationType]
      ? { kind: 'subscriptionCharge', token: purchaseToken, notificationType }
      : { kind: 'ignore', reason: `subscription type ${notificationType}` };
  }
  if (n.oneTimeProductNotification) {
    const { notificationType, purchaseToken, sku } = n.oneTimeProductNotification;
    return notificationType === ONE_TIME_PRODUCT_PURCHASED
      ? { kind: 'inappCharge', token: purchaseToken, sku }
      : { kind: 'ignore', reason: `one-time type ${notificationType}` };
  }
  if (n.voidedPurchaseNotification) {
    const v = n.voidedPurchaseNotification;
    return {
      kind: 'refund',
      orderId: v.orderId,
      token: v.purchaseToken,
      productType: v.productType === 1 ? 'subscription' : 'inapp',
      partial: v.refundType === 2,
    };
  }
  if (n.pendingRefundReviewNotification) return { kind: 'ignore', reason: 'pending refund review' };
  return { kind: 'ignore', reason: 'unknown notification' };
}

/** Firestore-safe document id for an order (order ids look like "GPA.1234-5678-9012-34567..0"). */
export const orderDocId = (prefix: string, orderId: string) => `${prefix}_${orderId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
