import { useEffect, useState } from 'react';
import {
  Timestamp, collection, doc, documentId, limit, onSnapshot, orderBy, query, where,
  type DocumentData, type DocumentSnapshot, type FirestoreError, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { firestore } from '../lib/firebase';
import { addDays, kstDateKey, kstParts, kstStartOfDay } from '../lib/kst';
import { dailyWindow } from './aggregate';
import type { AdUnitStats, AppInfo, DailyDoc, FxDoc, HourlyDoc, RawData, Store, SyncDoc, Transaction } from './types';

// ---------- Document mappers (defensive: missing numbers become 0) ----------

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const date = (v: unknown) => (v instanceof Timestamp ? v.toDate() : new Date(0));
const stores = (v: DocumentData | undefined) => ({ google: num(v?.google), apple: num(v?.apple) });

function toApp(s: QueryDocumentSnapshot): AppInfo {
  const d = s.data();
  return {
    id: s.id,
    name: typeof d.name === 'string' ? d.name : s.id,
    platform: Array.isArray(d.platform) ? d.platform : [],
    iconColor: typeof d.iconColor === 'string' ? d.iconColor : '#4A5468',
    iconUrl: typeof d.iconUrl === 'string' ? d.iconUrl : undefined,
    admobAppId: d.admobAppId,
    playPackage: d.playPackage,
    appStoreAppId: d.appStoreAppId,
  };
}

function toUnits(v: unknown): Record<string, AdUnitStats> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: Record<string, AdUnitStats> = {};
  for (const [k, u] of Object.entries(v as Record<string, DocumentData>)) {
    out[k] = {
      name: typeof u?.name === 'string' ? u.name : k,
      platform: u?.platform === 'android' || u?.platform === 'ios' ? u.platform : '',
      format: typeof u?.format === 'string' ? u.format : '',
      requests: num(u?.requests),
      matchedRequests: num(u?.matchedRequests),
      impressions: num(u?.impressions),
      clicks: num(u?.clicks),
      earningsMicros: num(u?.earningsMicros),
    };
  }
  return out;
}

function toDaily(s: QueryDocumentSnapshot): DailyDoc {
  const d = s.data();
  return {
    date: d.date,
    appId: d.appId,
    ad: {
      totalMicros: num(d.ad?.totalMicros),
      bySource: { admob: num(d.ad?.bySource?.admob), unity: num(d.ad?.bySource?.unity), other: num(d.ad?.bySource?.other) },
      units: toUnits(d.ad?.units),
    },
    inapp: stores(d.inapp),
    paid: stores(d.paid),
    status: d.status === 'final' ? 'final' : 'estimated',
  };
}

function toHourly(s: QueryDocumentSnapshot): HourlyDoc {
  const d = s.data();
  return { date: d.date, hour: num(d.hour), ad: num(d.ad), inapp: num(d.inapp), paid: num(d.paid) };
}

function toTransaction(s: QueryDocumentSnapshot): Transaction {
  const d = s.data();
  return {
    id: s.id,
    store: d.store === 'apple' ? 'apple' : 'google',
    appId: d.appId,
    productId: d.productId ?? '',
    productName: d.productName ?? d.productId ?? '',
    type: d.type,
    amountMicros: num(d.amountMicros),
    currency: d.currency ?? 'KRW',
    amountKrwMicros: num(d.amountKrwMicros),
    occurredAt: date(d.occurredAt),
    source: d.source,
  };
}

function toSync(s: QueryDocumentSnapshot): SyncDoc {
  const d = s.data();
  return { source: s.id as SyncDoc['source'], state: d.state, lastRunAt: date(d.lastRunAt), lastError: d.lastError, warning: d.warning };
}

function toFx(s: QueryDocumentSnapshot): FxDoc {
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.data())) if (typeof v === 'number') rates[k] = v;
  return { date: s.id, rates };
}

function toConfig(s: DocumentSnapshot): RawData['config'] {
  if (!s.exists()) return null;
  return { revenueBasis: s.data().revenueBasis === 'net' ? 'net' : 'gross' };
}

// ---------- Hook ----------

type Parts = { [K in keyof RawData]?: RawData[K] };
const KEYS: (keyof RawData)[] = ['config', 'apps', 'daily', 'hourly', 'transactions', 'refundsThisMonth', 'subscribers', 'sync', 'fx'];

/**
 * Live Firestore subscriptions for everything the dashboard shows.
 * Re-subscribes only when the KST date changes (window boundaries move).
 */
export function useFirestoreRaw(now: Date): { raw: RawData | null; error: string | null } {
  const today = kstDateKey(now);
  const [parts, setParts] = useState<Parts>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const db = firestore();
    const ref = new Date();
    const { from, to } = dailyWindow(ref);
    const monthStart = new Date(kstStartOfDay(ref).getTime() - (kstParts(ref).day - 1) * 86_400_000);
    const set = <K extends keyof RawData>(key: K) => (value: RawData[K]) => setParts((p) => ({ ...p, [key]: value }));
    const onError = (what: string) => (e: FirestoreError) => {
      console.error(`Firestore ${what}:`, e.code);
      setError(e.code === 'permission-denied' ? '데이터를 읽을 권한이 없습니다.' : '데이터를 불러오지 못했습니다. 연결을 확인해 주세요.');
    };

    const unsubs = [
      onSnapshot(doc(db, 'config', 'app'), (s) => set('config')(toConfig(s)), onError('config')),
      onSnapshot(collection(db, 'apps'), (s) => set('apps')(s.docs.map(toApp)), onError('apps')),
      onSnapshot(
        query(collection(db, 'daily'), where('date', '>=', from), where('date', '<=', to)),
        (s) => set('daily')(s.docs.map(toDaily)),
        onError('daily'),
      ),
      onSnapshot(
        query(collection(db, 'hourly'), where('date', '>=', addDays(to, -2))),
        (s) => set('hourly')(s.docs.map(toHourly)),
        onError('hourly'),
      ),
      onSnapshot(
        query(collection(db, 'transactions'), orderBy('occurredAt', 'desc'), limit(10)),
        (s) => set('transactions')(s.docs.map(toTransaction)),
        onError('transactions'),
      ),
      onSnapshot(
        // Needs the composite index in firestore.indexes.json (type ASC, occurredAt ASC).
        query(collection(db, 'transactions'), where('type', '==', 'refund'), where('occurredAt', '>=', Timestamp.fromDate(monthStart))),
        (s) => set('refundsThisMonth')(s.docs.map(toTransaction)),
        onError('refunds'),
      ),
      onSnapshot(
        collection(db, 'subscribers'),
        (s) => set('subscribers')(Object.fromEntries(s.docs.map((d) => [d.id as Store, num(d.data().active)]))),
        onError('subscribers'),
      ),
      onSnapshot(collection(db, 'sync'), (s) => set('sync')(s.docs.map(toSync)), onError('sync')),
      onSnapshot(
        // fx IDs are dates; ascending ID order needs no index, so take the newest of the last week.
        query(collection(db, 'fx'), where(documentId(), '>=', addDays(to, -7))),
        (s) => set('fx')(s.docs.length ? toFx(s.docs[s.docs.length - 1]) : null),
        onError('fx'),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [today]);

  const loaded = KEYS.every((k) => k in parts);
  return { raw: loaded ? (parts as RawData) : null, error };
}
