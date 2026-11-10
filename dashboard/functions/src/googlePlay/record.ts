// Idempotent write of one Play payment: the transaction doc, daily and hourly increments, and the
// processed-message marker happen in one Firestore transaction, so a redelivered Pub/Sub message or a
// second notification for the same order never double-counts.
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { hourKey, kstDateKey, kstParts } from '../shared/kst';

export interface PlayTransaction {
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
}

export type RecordResult = 'recorded' | 'duplicate-message' | 'duplicate-order';

export async function recordPlayTransaction(db: Firestore, messageId: string, tx: PlayTransaction): Promise<RecordResult> {
  const date = kstDateKey(tx.occurredAt);
  const hour = kstParts(tx.occurredAt).hour;
  const eventRef = db.doc(`rtdnEvents/${messageId}`);
  const txRef = db.doc(`transactions/${tx.id}`);
  const dailyRef = db.doc(`daily/${date}_${tx.appId}`);
  const hourlyRef = db.doc(`hourly/${hourKey(date, hour)}`);

  return db.runTransaction(async (t) => {
    const [event, existing, daily] = await Promise.all([t.get(eventRef), t.get(txRef), t.get(dailyRef)]);
    if (event.exists) return 'duplicate-message';
    t.create(eventRef, { receivedAt: Timestamp.now(), txId: tx.id });
    if (existing.exists) return 'duplicate-order';

    t.create(txRef, {
      store: 'google',
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
      source: 'rtdn',
    });

    // Subscriptions and refunds of in-app/subscription purchases count toward "inapp" (CLAUDE.md §4).
    const inc = FieldValue.increment(tx.amountKrwMicros);
    if (daily.exists) {
      t.update(dailyRef, { 'inapp.google': inc, updatedAt: Timestamp.now() });
    } else {
      t.set(dailyRef, {
        date,
        appId: tx.appId,
        ad: { totalMicros: 0, bySource: { admob: 0, unity: 0, other: 0 } },
        inapp: { google: tx.amountKrwMicros, apple: 0 },
        paid: { google: 0, apple: 0 },
        status: 'estimated',
        updatedAt: Timestamp.now(),
      });
    }
    t.set(hourlyRef, { date, hour, inapp: inc }, { merge: true });
    return 'recorded';
  });
}
