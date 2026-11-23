// Correction layer for App Store: the daily Sales report (App Store Connect API) replaces the
// notification-based estimates in daily/{date}_{appId}.inapp.apple and adds paid.apple (paid downloads
// send no notification). Re-running a date gives the same result.
//
// Day boundary: Apple names report days in its own reporting time zone (TODO(verify): Pacific Time per
// common use; the docs don't state it) and the report has no hours, so report day D is written to the KST
// key D. Notification estimates for D may have sat a few hours off; the totals over days still match.
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { krwPerUnit } from '../fx/rates';
import { db } from '../shared/firestore';
import { addDays, kstDateKey } from '../shared/kst';
import { toKrwMicros } from '../shared/money';
import { AscError, ascToken, fetchDailySales, listAppSkus, type AscCredentials } from '../appStore/connect';
import { parseSalesReport, totalSales, type SalesTotal } from '../appStore/salesReport';

/** A missing report this many days back (or older) means no sales, not "not generated yet". */
const NO_REPORT_MEANS_ZERO_AFTER_DAYS = 3;

export type DateOutcome = 'reconciled' | 'zeroed' | 'not-ready';

export interface AppleDayAmounts {
  inapp: number; // KRW micros, gross (tax excluded, commission included)
  paid: number;
  inappNet: number;
  paidNet: number;
}

/** Turns report totals into per-app KRW amounts. Currencies without an fx rate are skipped and returned. */
export async function toAppAmounts(
  totals: SalesTotal[],
  date: string,
  appIdForSku: (sku: string) => string,
  rate: (currency: string, date: string) => Promise<number> = krwPerUnit,
): Promise<{ byApp: Map<string, AppleDayAmounts>; missingFx: string[] }> {
  const byApp = new Map<string, AppleDayAmounts>();
  const missingFx = new Set<string>();
  for (const t of totals) {
    let r: number;
    try {
      r = await rate(t.currency, date);
    } catch {
      missingFx.add(t.currency);
      continue;
    }
    const appId = appIdForSku(t.appSku);
    const a = byApp.get(appId) ?? { inapp: 0, paid: 0, inappNet: 0, paidNet: 0 };
    a[t.kind] += toKrwMicros(t.grossMicros, r);
    a[t.kind === 'inapp' ? 'inappNet' : 'paidNet'] += toKrwMicros(t.netMicros, r);
    byApp.set(appId, a);
  }
  return { byApp, missingFx: [...missingFx] };
}

/** Overwrites Apple amounts for one date: every app in `byApp`, and zero for apps that had Apple estimates. */
async function writeDay(date: string, byApp: Map<string, AppleDayAmounts>, reportDate: string | null) {
  const existing = await db.collection('daily').where('date', '==', date).get();
  const had = existing.docs
    .filter((d) => (d.get('inapp.apple') ?? 0) !== 0 || (d.get('paid.apple') ?? 0) !== 0 || d.get('reconciled.apple'))
    .map((d) => d.get('appId') as string);
  const ids = new Set([...byApp.keys(), ...had]);
  const exists = new Set(existing.docs.map((d) => d.id));
  const now = Timestamp.now();
  const batch = db.batch();
  for (const appId of ids) {
    const a = byApp.get(appId) ?? { inapp: 0, paid: 0, inappNet: 0, paidNet: 0 };
    const ref = db.doc(`daily/${date}_${appId}`);
    const reconciled = { at: now, reportDate, inappNet: a.inappNet, paidNet: a.paidNet };
    if (exists.has(ref.id)) {
      batch.update(ref, { 'inapp.apple': a.inapp, 'paid.apple': a.paid, 'reconciled.apple': reconciled, updatedAt: now });
    } else {
      batch.set(ref, {
        date,
        appId,
        ad: { totalMicros: 0, bySource: { admob: 0, unity: 0, other: 0 } },
        inapp: { google: 0, apple: a.inapp },
        paid: { google: 0, apple: a.paid },
        status: 'estimated',
        reconciled: { apple: reconciled },
        updatedAt: now,
      });
    }
  }
  await batch.commit();
  return ids.size;
}

async function appIdResolver(token: string) {
  const [skuToBundle, apps] = await Promise.all([listAppSkus(token), db.collection('apps').get()]);
  const bundleToApp = new Map<string, string>();
  for (const d of apps.docs) {
    const b = d.get('appStoreBundleId');
    if (typeof b === 'string' && b) bundleToApp.set(b, d.id);
  }
  // Same fallback ids as the webhook, so estimates and report land on the same doc.
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
  return (sku: string) => {
    const bundle = skuToBundle.get(sku);
    if (!bundle) return `as_sku_${safe(sku)}`;
    return bundleToApp.get(bundle) ?? `as_${safe(bundle)}`;
  };
}

export interface AppStoreReconcileResult {
  dates: Record<string, DateOutcome>;
  missingFx: string[];
}

/** Reconciles report days `from`..`to` (YYYY-MM-DD, inclusive). */
export async function reconcileAppStore(c: AscCredentials, from: string, to: string, now = new Date()): Promise<AppStoreReconcileResult> {
  const today = kstDateKey(now);
  const smallBusiness = (await db.doc('config/app').get()).get('appleSmallBusiness') === true;
  let token = ascToken(c);
  let tokenAt = Date.now();
  const resolve = await appIdResolver(token);

  const dates: Record<string, DateOutcome> = {};
  const missingFx = new Set<string>();
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (Date.now() - tokenAt > 10 * 60_000) {
      token = ascToken(c);
      tokenAt = Date.now();
    }
    const report = await fetchDailySales(c, token, date);
    if (report.kind === 'missing') {
      const old = date <= addDays(today, -NO_REPORT_MEANS_ZERO_AFTER_DAYS);
      if (!report.noSales && !old) {
        dates[date] = 'not-ready';
        continue;
      }
      await writeDay(date, new Map(), null);
      dates[date] = 'zeroed';
      continue;
    }
    const totals = totalSales(parseSalesReport(report.tsv), smallBusiness);
    const { byApp, missingFx: miss } = await toAppAmounts(totals, date, resolve);
    miss.forEach((m) => missingFx.add(m));
    const n = await writeDay(date, byApp, date);
    dates[date] = 'reconciled';
    logger.info('app store reconciled', { date, apps: n, rows: totals.length });
  }
  return { dates, missingFx: [...missingFx] };
}

/** Dashboard message for a failure (Korean, no tokens or payloads). */
export function appStoreErrorMessage(e: unknown): string {
  if (e instanceof AscError && (e.status === 401 || e.status === 403)) {
    return 'App Store Connect API 키가 거부되었습니다. 키 ID·Issuer ID·.p8 키와 권한(Sales 또는 Finance)을 확인하세요.';
  }
  return 'App Store Sales 리포트 보정 중 오류가 났습니다. 다음 실행 때 다시 시도합니다.';
}
