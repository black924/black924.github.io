// Shared write step of the correction layer: one store's report amounts replace that store's
// estimates in daily/{date}_{appId} (inapp.{store}, paid.{store}). Apps that had amounts for the
// store on that date but are absent from the report are set to 0. `reconciled.{store}` marks the day
// so later payment notifications for it are not added again (googlePlay/record.ts).
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../shared/firestore';

export type Store = 'google' | 'apple';

export interface StoreDayAmounts {
  inapp: number; // KRW micros, gross (tax excluded, store fee included)
  paid: number;
  inappNet?: number;
  paidNet?: number;
}

export async function writeStoreDay(
  store: Store,
  date: string,
  byApp: Map<string, StoreDayAmounts>,
  meta: Record<string, unknown>,
): Promise<number> {
  const existing = await db.collection('daily').where('date', '==', date).get();
  const had = existing.docs
    .filter((d) => (d.get(`inapp.${store}`) ?? 0) !== 0 || (d.get(`paid.${store}`) ?? 0) !== 0 || d.get(`reconciled.${store}`))
    .map((d) => d.get('appId') as string);
  const ids = new Set([...byApp.keys(), ...had]);
  const exists = new Set(existing.docs.map((d) => d.id));
  const now = Timestamp.now();
  const batch = db.batch();
  for (const appId of ids) {
    const a = byApp.get(appId) ?? { inapp: 0, paid: 0 };
    const ref = db.doc(`daily/${date}_${appId}`);
    const reconciled = {
      at: now,
      ...meta,
      ...(a.inappNet !== undefined ? { inappNet: a.inappNet } : {}),
      ...(a.paidNet !== undefined ? { paidNet: a.paidNet } : {}),
    };
    if (exists.has(ref.id)) {
      batch.update(ref, { [`inapp.${store}`]: a.inapp, [`paid.${store}`]: a.paid, [`reconciled.${store}`]: reconciled, updatedAt: now });
    } else {
      const zero = { google: 0, apple: 0 };
      batch.set(ref, {
        date,
        appId,
        ad: { totalMicros: 0, bySource: { admob: 0, unity: 0, other: 0 } },
        inapp: { ...zero, [store]: a.inapp },
        paid: { ...zero, [store]: a.paid },
        status: 'estimated',
        reconciled: { [store]: reconciled },
        updatedAt: now,
      });
    }
  }
  await batch.commit();
  return ids.size;
}
