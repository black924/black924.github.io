// Correction layer for Google Play: the monthly Sales report in the Play Console Cloud Storage bucket
// (gs://<bucket>/sales/salesreport_YYYYMM.zip) replaces the RTDN estimates in daily.inapp.google and adds
// paid.google (paid-app downloads send no RTDN).
//
// Google posts sales data with a 3–7 day delay, so a day is only overwritten once the file holds an order
// charged after that day ended (KST). Earlier days keep their estimates until a later run.
// Access: the Functions runtime service account is a Play Console user with "View financial data" (Global).
import { GoogleAuth } from 'google-auth-library';
import { logger } from 'firebase-functions';
import { krwPerUnit } from '../fx/rates';
import { db } from '../shared/firestore';
import { decodeText, parseCsv, readZip } from '../shared/files';
import { addDays, kstDateKey } from '../shared/kst';
import { toKrwMicros } from '../shared/money';
import { parsePlaySales, type PlaySale } from '../googlePlay/salesReport';
import { writeStoreDay, type StoreDayAmounts } from './daily';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/devstorage.read_only'] });

export class PlayReportError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Object bytes, or null when the object doesn't exist (e.g. a month with no sales yet). */
async function download(bucket: string, object: string): Promise<Buffer | null> {
  const token = await auth.getAccessToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new PlayReportError(res.status, `Play report download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** "pubsite_prod_rev_0123…" from either the bare id or the gs:// URI Play Console copies. */
export function bucketName(v: string): string {
  return v.trim().replace(/^gs:\/\//, '').split('/')[0];
}

const monthKey = (date: string) => date.slice(0, 7).replace('-', ''); // 2026-11-05 → 202611

export function salesObjects(from: string, to: string): string[] {
  const months = new Set<string>();
  for (let d = from; d <= to; d = addDays(d, 1)) months.add(monthKey(d));
  return [...months].map((m) => `sales/salesreport_${m}.zip`);
}

/** Days `from`..`to` that ended before the newest order in the file (so the file covers them fully). */
export function completeDates(from: string, to: string, latestAt: Date | null): string[] {
  if (!latestAt) return [];
  const lastIncomplete = kstDateKey(latestAt); // the day of the newest order may still be filling
  const out: string[] = [];
  for (let d = from; d <= to && d < lastIncomplete; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Sums sales per date and app in KRW. Currencies without an fx rate are skipped and returned. */
export async function toDayAmounts(
  sales: PlaySale[],
  dates: Set<string>,
  appIdForPkg: (pkg: string) => string,
  rate: (currency: string, date: string) => Promise<number> = krwPerUnit,
): Promise<{ byDate: Map<string, Map<string, StoreDayAmounts>>; missingFx: string[] }> {
  const byDate = new Map<string, Map<string, StoreDayAmounts>>();
  const missingFx = new Set<string>();
  const rates = new Map<string, number | null>();
  for (const s of sales) {
    if (!dates.has(s.date)) continue;
    const key = `${s.currency}|${s.date}`;
    if (!rates.has(key)) rates.set(key, await rate(s.currency, s.date).catch(() => null));
    const r = rates.get(key);
    if (r == null) {
      missingFx.add(s.currency);
      continue;
    }
    const day = byDate.get(s.date) ?? new Map<string, StoreDayAmounts>();
    const appId = appIdForPkg(s.pkg);
    const a = day.get(appId) ?? { inapp: 0, paid: 0 };
    a[s.kind] += toKrwMicros(s.grossMicros, r);
    day.set(appId, a);
    byDate.set(s.date, day);
  }
  return { byDate, missingFx: [...missingFx] };
}

async function appIdResolver() {
  const apps = await db.collection('apps').get();
  const byPkg = new Map<string, string>();
  for (const d of apps.docs) {
    const p = d.get('playPackage');
    if (typeof p === 'string' && p) byPkg.set(p, d.id);
  }
  // Same fallback id as the RTDN handler.
  return (pkg: string) => byPkg.get(pkg) ?? `gp_${pkg.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

export interface PlayReconcileResult {
  reconciled: string[];
  pending: string[];
  missingFx: string[];
  skippedStatuses: Record<string, number>;
}

/** Reconciles KST days `from`..`to` that the Sales report fully covers. */
export async function reconcileGooglePlay(bucketSetting: string, from: string, to: string): Promise<PlayReconcileResult> {
  const bucket = bucketName(bucketSetting);
  const sales: PlaySale[] = [];
  let latestAt: Date | null = null;
  const skippedStatuses: Record<string, number> = {};
  for (const object of salesObjects(from, to)) {
    const zip = await download(bucket, object);
    if (!zip) continue;
    for (const entry of readZip(zip)) {
      if (!entry.name.toLowerCase().endsWith('.csv')) continue;
      const p = parsePlaySales(parseCsv(decodeText(entry.data)));
      sales.push(...p.sales);
      if (p.latestAt && (!latestAt || p.latestAt > latestAt)) latestAt = p.latestAt;
      for (const [k, n] of Object.entries(p.skippedStatuses)) skippedStatuses[k] = (skippedStatuses[k] ?? 0) + n;
    }
  }

  const dates = completeDates(from, to, latestAt);
  const { byDate, missingFx } = await toDayAmounts(sales, new Set(dates), await appIdResolver());
  for (const date of dates) {
    const n = await writeStoreDay('google', date, byDate.get(date) ?? new Map(), { source: 'sales_report' });
    logger.info('google play reconciled', { date, apps: n });
  }
  const pending: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!dates.includes(d)) pending.push(d);
  if (Object.keys(skippedStatuses).length) logger.warn('play sales: rows with other statuses skipped', skippedStatuses);
  return { reconciled: dates, pending, missingFx, skippedStatuses };
}

export function googlePlayErrorMessage(e: unknown): string {
  if (e instanceof PlayReportError && (e.status === 401 || e.status === 403)) {
    return 'Play 재무 리포트 버킷에 접근할 수 없습니다. 서비스 계정의 "재무 데이터 보기" 권한(전체)을 확인하세요.';
  }
  return 'Play 재무 리포트 보정 중 오류가 났습니다. 다음 실행 때 다시 시도합니다.';
}
