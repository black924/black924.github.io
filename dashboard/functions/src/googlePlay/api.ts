// Google Play Developer API (androidpublisher v3) with the Functions service account.
import { GoogleAuth } from 'google-auth-library';
import type { Money } from '../shared/money';

const BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/androidpublisher'] });

/** Retryable = the message should be redelivered (permissions not granted yet, quota, outage). */
export class PlayApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
  get retryable() {
    return this.status === 401 || this.status === 403 || this.status === 429 || this.status >= 500;
  }
}

async function get<T>(path: string): Promise<T> {
  const token = await auth.getAccessToken();
  const res = await fetch(`${BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new PlayApiError(`Play API ${path.split('/')[1] ?? ''} ${res.status}`, res.status);
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

export interface SubscriptionPurchaseV2 {
  testPurchase?: object;
  latestOrderId?: string; // present in the docs' sample, not in the resource table
  lineItems?: { productId: string; latestSuccessfulOrderId?: string; expiryTime?: string }[];
}

export const getSubscription = (pkg: string, token: string) =>
  get<SubscriptionPurchaseV2>(`${enc(pkg)}/purchases/subscriptionsv2/tokens/${enc(token)}`);

export interface ProductPurchase {
  purchaseState?: number; // 0 purchased, 1 canceled, 2 pending
  purchaseType?: number; // 0 test, 1 promo, 2 rewarded (absent for normal purchases)
  orderId?: string;
  productId?: string;
  quantity?: number;
}

export const getProduct = (pkg: string, sku: string, token: string) =>
  get<ProductPurchase>(`${enc(pkg)}/purchases/products/${enc(sku)}/tokens/${enc(token)}`);

export interface RefundDetails {
  total?: Money;
  tax?: Money;
}

export interface Order {
  orderId: string;
  state?: string; // PENDING | PROCESSED | CANCELED | PENDING_REFUND | PARTIALLY_REFUNDED | REFUNDED
  createTime?: string;
  total?: Money;
  tax?: Money;
  developerRevenueInBuyerCurrency?: Money;
  lineItems?: { productId?: string; productTitle?: string; total?: Money; tax?: Money }[];
  orderHistory?: {
    refundEvent?: { eventTime?: string; refundDetails?: RefundDetails };
    partialRefundEvents?: { state?: string; refundDetails?: RefundDetails }[];
  };
}

export const getOrder = (pkg: string, orderId: string) => get<Order>(`${enc(pkg)}/orders/${enc(orderId)}`);
