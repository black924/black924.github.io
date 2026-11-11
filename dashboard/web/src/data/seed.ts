// Deterministic sample data in the exact Firestore shape (CLAUDE.md §4).
// Used by `npm run seed` (emulator) and by mock mode when Firebase is not configured.
import { addDays, kstDateKey, kstParts, kstStartOfDay } from '../lib/kst';
import { MICROS_PER_UNIT } from '../lib/format';
import { dailyWindow } from './aggregate';
import appsJson from './apps.json';
import type { AdUnitStats, AppInfo, DailyDoc, HourlyDoc, RawData, Store, SyncDoc, Transaction } from './types';

export const SEED_APPS: AppInfo[] = appsJson as AppInfo[];

// Sample average daily won per app (not real figures), and the Google Play share of store revenue.
const BASE: Record<string, { ad: number; inapp: number; paid: number; googleShare: number }> = {
  noiselog: { ad: 168_000, inapp: 72_000, paid: 0, googleShare: 0.6 },
  defectchecker: { ad: 38_000, inapp: 91_000, paid: 0, googleShare: 0.5 },
  breeze: { ad: 46_000, inapp: 8_000, paid: 0, googleShare: 1 },
  remit: { ad: 41_000, inapp: 26_000, paid: 0, googleShare: 1 },
  schoolit: { ad: 63_000, inapp: 5_000, paid: 0, googleShare: 1 },
};

// Sample products for the fake payment feed.
const PRODUCTS: Record<string, { id: string; name: string; type: Transaction['type']; won: number; usd: number }[]> = {
  noiselog: [
    { id: 'noiselog.pro', name: '프로 업그레이드', type: 'inapp', won: 4_400, usd: 2.99 },
    { id: 'noiselog.monthly', name: '월간 구독', type: 'subscription', won: 2_500, usd: 1.99 },
  ],
  defectchecker: [
    { id: 'defectchecker.report', name: 'PDF 리포트 내보내기', type: 'inapp', won: 9_900, usd: 6.99 },
  ],
  breeze: [{ id: 'breeze.noads', name: '광고 제거', type: 'inapp', won: 2_200, usd: 1.49 }],
  remit: [{ id: 'remit.premium', name: '프리미엄 구독', type: 'subscription', won: 3_300, usd: 2.49 }],
  schoolit: [{ id: 'schoolit.noads', name: '광고 제거', type: 'inapp', won: 1_500, usd: 0.99 }],
};

export const SEED_USD_KRW = 1_382;

// Sample ad units per app: share of the app's ad earnings, eCPM (won), show rate, match rate.
const UNITS: Record<string, { key: string; name: string; format: string; share: number; ecpm: number; show: number; match: number }[]> = {
  noiselog: [
    { key: '1001', name: '측정 화면 배너', format: 'banner', share: 0.5, ecpm: 650, show: 0.62, match: 0.93 },
    { key: '1002', name: '기록 저장 전면', format: 'interstitial', share: 0.38, ecpm: 5200, show: 0.71, match: 0.88 },
    { key: '1003', name: '리포트 보상형', format: 'rewarded', share: 0.12, ecpm: 9100, show: 0.86, match: 0.9 },
  ],
  defectchecker: [
    { key: '2001', name: '체크리스트 배너', format: 'banner', share: 0.7, ecpm: 540, show: 0.6, match: 0.91 },
    { key: '2002', name: 'PDF 생성 전면', format: 'interstitial', share: 0.3, ecpm: 4800, show: 0.68, match: 0.86 },
  ],
  breeze: [{ key: '3001', name: '홈 네이티브', format: 'native', share: 1, ecpm: 1900, show: 0.58, match: 0.84 }],
  remit: [
    { key: '4001', name: '타이머 배너', format: 'banner', share: 0.65, ecpm: 480, show: 0.57, match: 0.9 },
    { key: '4002', name: '앱 오프닝', format: 'app_open', share: 0.35, ecpm: 3100, show: 0.64, match: 0.82 },
  ],
  schoolit: [
    { key: '5001', name: '급식 배너', format: 'banner', share: 0.8, ecpm: 520, show: 0.61, match: 0.94 },
    { key: '5002', name: '시간표 전면', format: 'interstitial', share: 0.2, ecpm: 4400, show: 0.69, match: 0.87 },
  ],
};

/** Splits an app's ad earnings into ad units with plausible request/impression counts. */
function makeUnits(appId: string, adMicros: number): Record<string, AdUnitStats> {
  const out: Record<string, AdUnitStats> = {};
  const platforms = SEED_APPS.find((a) => a.id === appId)?.platform ?? ['android'];
  // Apps on both stores: Android 65% / iOS 35% of ad earnings, same unit set on each.
  const list = platforms.flatMap((platform) =>
    (UNITS[appId] ?? []).map((u) => ({
      ...u,
      key: platform === 'ios' ? `${u.key}i` : u.key,
      platform,
      share: u.share * (platforms.length > 1 ? (platform === 'android' ? 0.65 : 0.35) : 1),
    })),
  );
  let left = adMicros;
  list.forEach((u, i) => {
    const earningsMicros = i === list.length - 1 ? left : Math.round(adMicros * u.share);
    left -= earningsMicros;
    const impressions = Math.round((earningsMicros / MICROS_PER_UNIT / u.ecpm) * 1000);
    const matchedRequests = Math.round(impressions / u.show);
    const requests = Math.round(matchedRequests / u.match);
    out[u.key] = { name: u.name, platform: u.platform, format: u.format, requests, matchedRequests, impressions, clicks: Math.round(impressions * 0.012), earningsMicros };
  });
  return out;
}

// Share of a day's revenue per KST hour (sums to 1).
const HOUR_WEIGHTS = (() => {
  const raw = Array.from({ length: 24 }, (_, h) => 0.35 + Math.max(0, Math.sin(((h - 6) / 18) * Math.PI)) * (h >= 20 ? 1.25 : 1));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / total);
})();

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable pseudo-random in [0, 1). */
const rand = (seed: string) => (hash(seed) % 100_000) / 100_000;
const won = (w: number) => Math.round(w) * MICROS_PER_UNIT;

function dayWon(appId: string, date: string) {
  const b = BASE[appId];
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const f = wd === 0 || wd === 6 ? 1.18 : 1;
  const n = (k: string) => 0.75 + rand(`${appId}|${date}|${k}`) * 0.5;
  return { ad: b.ad * f * n('ad'), inapp: b.inapp * f * n('inapp'), paid: b.paid * f * n('paid') };
}

/** Per-hour micros of one app; `upto` < 1 for the hour in progress. */
function hourMicros(appId: string, date: string, h: number, upto = 1) {
  const day = dayWon(appId, date);
  const w = HOUR_WEIGHTS[h] * upto;
  return { ad: won(day.ad * w), inapp: won(day.inapp * w), paid: won(day.paid * w) };
}

const splitStore = (v: number, googleShare: number) => {
  const google = Math.round(v * googleShare);
  return { google, apple: v - google };
};

function makeDaily(appId: string, date: string, hoursDone: number, minute: number, status: DailyDoc['status']): DailyDoc {
  let ad = 0, inapp = 0, paid = 0;
  for (let h = 0; h < 24; h++) {
    if (h > hoursDone) break;
    const m = hourMicros(appId, date, h, h === hoursDone ? minute / 60 : 1);
    ad += m.ad;
    inapp += m.inapp;
    paid += m.paid;
  }
  const unity = Math.round(ad * (0.2 + rand(`${appId}|${date}|u`) * 0.08));
  const other = Math.round(ad * (0.05 + rand(`${appId}|${date}|o`) * 0.04));
  const share = BASE[appId].googleShare;
  return {
    date,
    appId,
    ad: { totalMicros: ad, bySource: { admob: ad - unity - other, unity, other }, units: makeUnits(appId, ad) },
    inapp: splitStore(inapp, share),
    paid: splitStore(paid, share),
    status,
  };
}

export function makeTransaction(id: string, at: Date, refund = false): Transaction {
  const app = SEED_APPS[hash(`${id}|app`) % SEED_APPS.length];
  const products = PRODUCTS[app.id];
  const product = products[hash(`${id}|p`) % products.length];
  const store: Store = app.platform.includes('ios') && rand(`${id}|s`) > BASE[app.id].googleShare ? 'apple' : 'google';
  const usd = store === 'apple' && rand(`${id}|c`) > 0.55;
  const sign = refund ? -1 : 1;
  return {
    id,
    store,
    appId: app.id,
    productId: product.id,
    productName: product.name,
    type: refund ? 'refund' : product.type,
    amountMicros: sign * (usd ? Math.round(product.usd * 100) * 10_000 : product.won * MICROS_PER_UNIT),
    currency: usd ? 'USD' : 'KRW',
    amountKrwMicros: sign * (usd ? Math.round(product.usd * SEED_USD_KRW) : product.won) * MICROS_PER_UNIT,
    occurredAt: at,
    source: store === 'google' ? 'rtdn' : 'asn',
  };
}

function seedSync(now: Date, lastGoogle: Date, lastApple: Date): SyncDoc[] {
  const halfHour = 30 * 60_000;
  let admob = new Date(Math.floor(now.getTime() / halfHour) * halfHour + 2 * 60_000);
  if (admob > now) admob = new Date(admob.getTime() - halfHour);
  let reconcile = new Date(kstStartOfDay(now).getTime() + 4 * 3_600_000 + 7 * 60_000);
  if (reconcile > now) reconcile = new Date(reconcile.getTime() - 86_400_000);
  return [
    { source: 'admob', state: 'ok', lastRunAt: admob },
    { source: 'google_play', state: 'ok', lastRunAt: lastGoogle },
    { source: 'app_store', state: 'ok', lastRunAt: lastApple },
    { source: 'reconcile', state: 'scheduled', lastRunAt: reconcile },
  ];
}

export function generateSeed(now: Date): RawData {
  const today = kstDateKey(now);
  const yesterday = addDays(today, -1);
  const { hour, minute, day } = kstParts(now);
  const { from } = dailyWindow(now);

  const daily: DailyDoc[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    for (const app of SEED_APPS) {
      daily.push(d === today ? makeDaily(app.id, d, hour, minute, 'estimated') : makeDaily(app.id, d, 23, 60, 'final'));
    }
  }

  const hourly: HourlyDoc[] = [];
  for (const [date, last] of [[addDays(today, -2), 23], [yesterday, 23], [today, hour]] as const) {
    for (let h = 0; h <= last; h++) {
      const doc: HourlyDoc = { date, hour: h, ad: 0, inapp: 0, paid: 0 };
      for (const app of SEED_APPS) {
        const m = hourMicros(app.id, date, h, date === today && h === hour ? minute / 60 : 1);
        doc.ad += m.ad;
        doc.inapp += m.inapp;
        doc.paid += m.paid;
      }
      hourly.push(doc);
    }
  }

  const recent = Array.from({ length: 10 }, (_, i) => {
    const minutesAgo = Math.round(4 + i * 11 + rand(`tx-gap|${i}`) * 9);
    return makeTransaction(`seed-${today}-${i}`, new Date(now.getTime() - minutesAgo * 60_000));
  });

  // A few refunds spread over the month so far.
  const monthStart = new Date(kstStartOfDay(now).getTime() - (day - 1) * 86_400_000);
  const span = now.getTime() - monthStart.getTime();
  const refunds = Array.from({ length: 3 + (hash(today.slice(0, 7)) % 4) }, (_, i) =>
    makeTransaction(`refund-${today.slice(0, 7)}-${i}`, new Date(monthStart.getTime() + span * rand(`r|${i}`) * 0.9), true),
  );

  const transactions = [...recent, ...refunds].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const lastOf = (s: Store) => transactions.find((t) => t.store === s)?.occurredAt ?? now;

  return {
    config: { revenueBasis: 'gross' },
    apps: SEED_APPS,
    daily,
    hourly,
    transactions,
    refundsThisMonth: refunds,
    subscribers: { google: 412, apple: 287 },
    sync: seedSync(now, lastOf('google'), lastOf('apple')),
    fx: { date: today, rates: { USD: SEED_USD_KRW, JPY: 9.12 } },
  };
}

/** Where a payment lands in daily/hourly docs. Shared with the emulator simulator. */
export function transactionTarget(tx: Transaction) {
  const date = kstDateKey(tx.occurredAt);
  const category: 'inapp' | 'paid' = tx.type === 'paid' ? 'paid' : 'inapp';
  return { date, hour: kstParts(tx.occurredAt).hour, dailyId: `${date}_${tx.appId}`, category };
}

export function emptyDaily(date: string, appId: string): DailyDoc {
  return {
    date,
    appId,
    ad: { totalMicros: 0, bySource: { admob: 0, unity: 0, other: 0 } },
    inapp: { google: 0, apple: 0 },
    paid: { google: 0, apple: 0 },
    status: 'estimated',
  };
}

/** Mock-mode equivalent of a Cloud Function recording a payment. Returns new data. */
export function applyTransaction(raw: RawData, tx: Transaction): RawData {
  const { date, hour, category } = transactionTarget(tx);
  const hasDaily = raw.daily.some((d) => d.date === date && d.appId === tx.appId);
  const baseDaily = hasDaily ? raw.daily : [...raw.daily, emptyDaily(date, tx.appId)];
  const daily = baseDaily.map((d) =>
    d.date === date && d.appId === tx.appId
      ? { ...d, [category]: { ...d[category], [tx.store]: d[category][tx.store] + tx.amountKrwMicros } }
      : d,
  );
  const hasHour = raw.hourly.some((h) => h.date === date && h.hour === hour);
  const baseHourly = hasHour ? raw.hourly : [...raw.hourly, { date, hour, ad: 0, inapp: 0, paid: 0 }];
  const hourly = baseHourly.map((h) => (h.date === date && h.hour === hour ? { ...h, [category]: h[category] + tx.amountKrwMicros } : h));
  const source = tx.store === 'google' ? 'google_play' : 'app_store';
  return {
    ...raw,
    daily,
    hourly,
    transactions: [tx, ...raw.transactions],
    refundsThisMonth: tx.type === 'refund' ? [tx, ...raw.refundsThisMonth] : raw.refundsThisMonth,
    sync: raw.sync.map((s) => (s.source === source ? { ...s, lastRunAt: tx.occurredAt } : s)),
  };
}
