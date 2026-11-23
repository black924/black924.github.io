// Pure parts of App Store Server Notifications V2 handling: what a notification means and how much it is.
// Field meanings: developer.apple.com/documentation/appstoreservernotifications and the
// @apple/app-store-server-library models (JWSTransactionDecodedPayload, NotificationTypeV2).
import type { JWSTransactionDecodedPayload, ResponseBodyV2DecodedPayload } from '@apple/app-store-server-library';

export type AsnAction =
  | { kind: 'test' }
  | { kind: 'ignore'; reason: string }
  | { kind: 'charge' }
  | { kind: 'refund' };

/** Notifications that move money. Renewal-preference changes, expiries, failed renewals etc. do not. */
export function classifyAsn(n: Pick<ResponseBodyV2DecodedPayload, 'notificationType' | 'subtype'>): AsnAction {
  switch (n.notificationType) {
    case 'TEST':
      return { kind: 'test' };
    case 'SUBSCRIBED': // INITIAL_BUY or RESUBSCRIBE
    case 'DID_RENEW':
    case 'ONE_TIME_CHARGE':
      return { kind: 'charge' };
    case 'REFUND':
      return { kind: 'refund' };
    default:
      return { kind: 'ignore', reason: `${n.notificationType ?? 'unknown'}${n.subtype ? `/${n.subtype}` : ''}` };
  }
}

/** Where a signed payload claims to come from, read WITHOUT verifying (only to pick the verifier). */
export function peekPayload(signedPayload: string): { bundleId?: string; environment?: string; appAppleId?: number } {
  const part = signedPayload.split('.')[1];
  if (!part) throw new Error('Not a JWS');
  const body = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Pick<ResponseBodyV2DecodedPayload, 'data' | 'summary' | 'appData'>;
  const d = body.data ?? body.summary ?? body.appData;
  return { bundleId: d?.bundleId, environment: d?.environment, appAppleId: d?.appAppleId };
}

const SUBSCRIPTION_TYPES = new Set(['Auto-Renewable Subscription', 'Non-Renewing Subscription']);

export function transactionKind(t: JWSTransactionDecodedPayload): 'subscription' | 'inapp' {
  return t.type && SUBSCRIPTION_TYPES.has(t.type) ? 'subscription' : 'inapp';
}

/**
 * Amount charged, in micros of `t.currency`. `price` is milliunits of the price set in App Store Connect,
 * so micros = price × 1000. TODO(verify): whether `price` is per unit or already × quantity for consumables;
 * this assumes per unit. It includes VAT where the storefront price does (Apple sends no tax field);
 * the daily Sales report reconciliation corrects it.
 */
export function chargeMicros(t: JWSTransactionDecodedPayload): number {
  return (t.price ?? 0) * 1000 * Math.max(1, t.quantity ?? 1);
}

/** Amount refunded (positive). `revocationPercentage` is milliunits of a percent (100000 = 100%); absent = full. */
export function refundMicros(t: JWSTransactionDecodedPayload): number {
  const pct = t.revocationPercentage ?? 100_000;
  return Math.round((chargeMicros(t) * pct) / 100_000);
}

export const isSandbox = (environment: string | undefined) => environment === 'Sandbox';

/** Firestore-safe document id for an App Store transaction. */
export const transactionDocId = (prefix: string, transactionId: string) => `${prefix}_${transactionId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
