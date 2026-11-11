import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { db } from '../shared/firestore';
import { addDays, historyStart, hourKey, kstDateKey, kstParts, toDateParts } from '../shared/kst';
import { ADMOB_REFRESH_TOKEN, readSecret } from '../shared/secrets';
import { recordSyncError, recordSyncOk } from '../shared/sync';
import { AD_UNIT_SPEC, AdmobAuthError, accessTokenFromRefresh, generateMediationReport, getAccount, listApps } from './api';
import { aggregateDaily, groupAdUnits, mapApps, syntheticAppId, toUnitPlatform, parseAdUnitReport, parseMediationReport, planHourlyAd, type HourlyBase, type OurApp } from './report';

const MSG_NOT_CONNECTED = 'AdMob 계정이 연결되지 않았습니다. 연결 버튼을 눌러 주세요.';
const MSG_AUTH = 'AdMob 연결이 만료되었거나 권한이 없습니다. 다시 연결해 주세요.';
const MSG_FAILED = 'AdMob 리포트를 받지 못했습니다. 다음 주기에 다시 시도합니다.';

export interface AdmobCreds {
  clientId: string;
  clientSecret: string;
  refreshToken?: string; // pass right after OAuth; otherwise read from Secret Manager
  full?: boolean; // force the wide refresh (e.g. right after connecting)
}

/**
 * Re-fetches the mediation report and overwrites the ad part of daily/{date}_{appId}.
 * Usually today and yesterday (KST); once a day (and right after connecting) the whole window the
 * dashboard shows, so 7-day/month views have history and AdMob's later revisions are picked up.
 * Idempotent: running twice writes the same values.
 */
export async function runAdmobSync(creds: AdmobCreds, now = new Date()): Promise<void> {
  try {
    const refreshToken = creds.refreshToken ?? (await readSecret(ADMOB_REFRESH_TOKEN));
    if (!refreshToken) {
      await recordSyncError('admob', MSG_NOT_CONNECTED, { connected: false });
      return;
    }
    const token = await accessTokenFromRefresh(refreshToken, creds.clientId, creds.clientSecret);
    const account = await getAccount(token);

    const today = kstDateKey(now);
    const yesterday = addDays(today, -1);
    const syncRef = db.doc('sync/admob');
    const syncDoc = await syncRef.get();
    const full = creds.full || syncDoc.get('fullSyncDate') !== today;
    const from = full ? historyStart(today) : yesterday;
    const [admobApps, appsSnap, body, unitBody] = await Promise.all([
      listApps(token, account.name),
      db.collection('apps').get(),
      generateMediationReport(token, account.name, toDateParts(from), toDateParts(today)),
      generateMediationReport(token, account.name, toDateParts(from), toDateParts(today), AD_UNIT_SPEC),
    ]);

    const report = parseMediationReport(body);
    if (report.currency && report.currency !== 'KRW') throw new Error(`Report currency ${report.currency}, expected KRW`);

    const ours: OurApp[] = appsSnap.docs.map((d) => ({
      id: d.id,
      playPackage: d.get('playPackage'),
      appStoreAppId: d.get('appStoreAppId'),
      admobAppIds: d.get('admobAppIds'),
    }));
    const { map, unmatched } = mapApps(admobApps, ours);

    // An AdMob app that used to be unmatched now belongs to one of ours: drop its placeholder app
    // and daily docs, then redo the whole window so the history moves to the real app.
    const existingApps = new Set(appsSnap.docs.map((d) => d.id));
    const stale = [...map].filter(([admobId, ourId]) => ourId !== syntheticAppId(admobId) && existingApps.has(syntheticAppId(admobId)));
    if (stale.length) {
      for (const [admobId] of stale) {
        const id = syntheticAppId(admobId);
        const docs = await db.collection('daily').where('appId', '==', id).get();
        const w = db.bulkWriter();
        docs.docs.forEach((d) => w.delete(d.ref));
        w.delete(db.doc(`apps/${id}`));
        await w.close();
        logger.info('admob placeholder app merged', { id, dailyDocs: docs.size });
      }
      if (!full) return runAdmobSync({ ...creds, refreshToken, full: true }, now);
    }
    const daily = aggregateDaily(report.rows, map);
    const platformByAdmobApp = new Map(admobApps.map((a) => [a.appId, toUnitPlatform(a.platform)]));
    const units = groupAdUnits(parseAdUnitReport(unitBody), map, platformByAdmobApp);

    // BulkWriter: a full refresh can exceed the 500-write batch limit.
    const batch = db.bulkWriter();
    const nowTs = Timestamp.fromDate(now);

    // Remember which AdMob apps feed each of our apps.
    const idsByApp = new Map<string, string[]>();
    for (const [admobId, ourId] of map) idsByApp.set(ourId, [...(idsByApp.get(ourId) ?? []), admobId]);
    for (const a of ours) {
      const ids = idsByApp.get(a.id);
      if (ids) batch.set(db.doc(`apps/${a.id}`), { admobAppIds: ids }, { merge: true });
    }
    // AdMob apps not linked to any of ours still show up, under their AdMob name.
    for (const u of unmatched) {
      batch.set(
        db.doc(`apps/${u.ourId}`),
        { name: u.name, platform: [u.platform === 'IOS' ? 'ios' : 'android'], iconColor: '#4A5468', admobAppIds: [u.appId] },
        { merge: true },
      );
    }

    // Existing daily docs in range: zero out ad revenue that disappeared, keep status if final.
    const existing = await db.collection('daily').where('date', '>=', from).where('date', '<=', today).get();
    const existingById = new Map(existing.docs.map((d) => [d.id, d]));
    const zero = { totalMicros: 0, bySource: { admob: 0, unity: 0, other: 0 } };
    const ids = new Set([...daily.keys(), ...existing.docs.filter((d) => (d.get('ad.totalMicros') ?? 0) !== 0).map((d) => d.id)]);
    for (const id of ids) {
      const entry = daily.get(id);
      const prev = existingById.get(id);
      const date = entry?.date ?? prev!.get('date');
      const appId = entry?.appId ?? prev!.get('appId');
      const ad = entry ? { totalMicros: entry.totalMicros, bySource: entry.bySource, units: units.get(id) ?? {} } : { ...zero, units: {} };
      const fresh = prev ? {} : { inapp: { google: 0, apple: 0 }, paid: { google: 0, apple: 0 }, status: 'estimated' };
      // mergeFields replaces `ad` as a whole (so removed ad units disappear) and leaves inapp/paid/status alone.
      batch.set(db.doc(`daily/${id}`), { date, appId, ad, ...fresh, updatedAt: nowTs }, {
        mergeFields: ['date', 'appId', 'ad', 'updatedAt', ...Object.keys(fresh)],
      });
    }

    // Hourly ad approximation for today's chart.
    const prevBase = syncDoc.get('hourlyBase') as HourlyBase | undefined;
    const todayTotal = [...daily.values()].filter((d) => d.date === today).reduce((a, d) => a + d.totalMicros, 0);
    const { increments, base } = planHourlyAd(prevBase, today, kstParts(now).hour, todayTotal);
    for (const inc of increments) {
      batch.set(db.doc(`hourly/${hourKey(today, inc.hour)}`), { date: today, hour: inc.hour, ad: FieldValue.increment(inc.micros) }, { merge: true });
    }
    await batch.close();

    // Keep today, yesterday and the day before in hourly (CLAUDE.md §4).
    const old = await db.collection('hourly').where('date', '<', addDays(today, -2)).get();
    if (!old.empty) {
      const del = db.batch();
      old.docs.forEach((d) => del.delete(d.ref));
      await del.commit();
    }

    const warning =
      account.reportingTimeZone && account.reportingTimeZone !== 'Asia/Seoul'
        ? `AdMob 리포트 시간대가 ${account.reportingTimeZone}입니다. 날짜 경계를 KST와 맞추려면 AdMob 설정에서 시간대를 서울로 바꿔 주세요.`
        : FieldValue.delete();
    await recordSyncOk('admob', {
      connected: true,
      hourlyBase: base,
      ...(full ? { fullSyncDate: today, historyFrom: from } : {}),
      warning,
      account: { publisherId: account.publisherId, reportingTimeZone: account.reportingTimeZone, currencyCode: account.currencyCode },
    });
    logger.info('admob sync ok', { full, from, rows: report.rows.length, docs: ids.size, unmatched: unmatched.length });
  } catch (e) {
    const auth = e instanceof AdmobAuthError;
    logger.error('admob sync failed', { auth, message: (e as Error).message });
    await recordSyncError('admob', auth ? MSG_AUTH : MSG_FAILED, auth ? { connected: false } : {});
  }
}
