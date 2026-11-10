import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../shared/firestore';
import { addDays, kstDateKey } from '../shared/kst';
import { fetchFrankfurter } from './frankfurter';

/** Fetches today's rates and stores fx/{KST date} as { USD: 1350.63, JPY: 8.71, ..., source, rateDate }. */
export async function storeTodayRates(now = new Date()): Promise<Record<string, number>> {
  const { rateDate, krwPer } = await fetchFrankfurter();
  await db.doc(`fx/${kstDateKey(now)}`).set({ ...krwPer, source: 'frankfurter', rateDate });
  return krwPer;
}

/** KRW per 1 unit of `currency` for a KST date: newest fx doc within 10 days before it, else fetch now. */
export async function krwPerUnit(currency: string, dateKey: string): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === 'KRW') return 1;
  const snap = await db
    .collection('fx')
    .where(FieldPath.documentId(), '>=', addDays(dateKey, -10))
    .where(FieldPath.documentId(), '<=', dateKey)
    .get();
  for (const d of [...snap.docs].reverse()) {
    const v = d.get(cur);
    if (typeof v === 'number' && v > 0) return v;
  }
  const fresh = await storeTodayRates();
  const v = fresh[cur];
  if (typeof v !== 'number' || v <= 0) throw new Error(`No FX rate for ${cur}`);
  return v;
}
