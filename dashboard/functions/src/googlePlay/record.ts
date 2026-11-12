// Idempotent write of one store payment (Google Play or App Store): the transaction doc, daily and hourly
// increments, and the processed-notification marker happen in one Firestore transaction, so a redelivered
// notification or a second notification for the same order never double-counts.
// Test purchases only get the transaction doc.
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { hourKey, kstDateKey, kstParts } from '../shared/kst';

export interface StoreTransaction {
  id: string; // transactions/{id}
  appId: string;
  productId: string;
  productName: string;
  type: 'subscription' | 'inapp' | 'refund';
  orderId: string;
  currency: string;
  amountMicros: number; // gross, original currency (negative for refunds)
  amountKrwMicros: number;
  netMicros?: number;
  netKrwMicros?: number;
  occurredAt: Date;
  /** License-tester purchase: shown in the live feed, never added to daily/hourly revenue. */
  test?: boolean;
}

export type PlayTransaction = StoreTransaction;

export type RecordResult = 'recorded' | 'duplicate-message' | 'duplicate-order';

export function recordPlayTransaction(db: Firestore, messageId: string, tx: StoreTransaction): Promise<RecordResult> {
  return recordStoreTransaction(db, { store: 'google', source: 'rtdn', eventPath: `rtdnEvents/${messageId}` }, tx);
}

export async function recordStoreTransaction(
  db: Firestore,
  where: { store: 'google' | 'apple'; source: 'rtdn' | 'asn'; eventPath: string },
  tx: StoreTransaction,
): Promise<RecordResult> {
  const { store, source } = where;
  const date = kstDateKey(tx.occurredAt);
  const hour = kstParts(tx.occurredAt).hour;
  const eventRef = db.doc(where.eventPath);
  const txRef = db.doc(`transactions/${tx.id}`);
  const dailyRef = db.doc(`daily/${date}_${tx.appId}`);
  const hourlyRef = db.doc(`hourly/${hourKey(date, hour)}`);

  return db.runTransaction(async (t) => {
    const [event, existing, daily] = await Promise.all([t.get(eventRef), t.get(txRef), t.get(dailyRef)]);
    if (event.exists) return 'duplicate-message';
    t.create(eventRef, { receivedAt: Timestamp.now(), txId: tx.id });
    if (existing.exists) return 'duplicate-order';

    t.create(txRef, {
      store,
      appId: tx.appId,
      productId: tx.productId,
      productName: tx.productName,
      type: tx.type,
      orderId: tx.orderId,
      currency: tx.currency,
      amountMicros: tx.amountMicros,
      amountKrwMicros: tx.amountKrwMicros,
      ...(tx.netMicros !== undefined ? { netMicros: tx.netMicros, netKrwMicros: tx.netKrwMicros } : {}),
      occurredAt: Timestamp.fromDate(tx.occurredAt),
      source,
      ...(tx.test ? { test: true } : {}),
    });
    if (tx.test) return 'recorded';

    // Subscriptions and refunds of in-app/subscription purchases count toward "inapp" (CLAUDE.md §4).
    const inc = FieldValue.increment(tx.amountKrwMicros);
    if (daily.exists) {
      t.update(dailyRef, { [`inapp.${store}`]: inc, updatedAt: Timestamp.now() });
    } else {
      t.set(dailyRef, {
        date,
        appId: tx.appId,
        ad: { totalMicros: 0, bySource: { admob: 0, unity: 0, other: 0 } },
        inapp: { google: 0, apple: 0, [store]: tx.amountKrwMicros },
        paid: { google: 0, apple: 0 },
        status: 'estimated',
        updatedAt: Timestamp.now(),
      });
    }
    t.set(hourlyRef, { date, hour, inapp: inc }, { merge: true });
    return 'recorded';
  });
}
