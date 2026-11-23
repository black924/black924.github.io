import { onCall, onRequest } from 'firebase-functions/v2/https';
import { handleRequestSync } from './requestSync';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { logger } from 'firebase-functions';
import { FieldValue } from 'firebase-admin/firestore';
import { storeTodayRates } from './fx/rates';
import { handlePlayRtdn } from './googlePlay/handler';
import { handleAppStoreWebhook } from './appStore/handler';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { handleCallback, handleStart } from './admob/oauth';
import { runAdmobSync } from './admob/sync';
import { REGION } from './shared/region';
import { appStoreErrorMessage, reconcileAppStore } from './reconcile/appStore';
import { googlePlayErrorMessage, reconcileGooglePlay } from './reconcile/googlePlay';
import { db } from './shared/firestore';
import { addDays, kstDateKey } from './shared/kst';
import { recordSyncError, recordSyncOk } from './shared/sync';
import {
  ADMOB_OAUTH_CLIENT_ID, ADMOB_OAUTH_CLIENT_SECRET, ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY, ASC_VENDOR_NUMBER,
} from './shared/secrets';

const admobSecrets = [ADMOB_OAUTH_CLIENT_ID, ADMOB_OAUTH_CLIENT_SECRET];

export const admobOauthStart = onRequest({ region: REGION, secrets: admobSecrets, maxInstances: 1 }, (req, res) =>
  handleStart(req, res, ADMOB_OAUTH_CLIENT_ID.value()),
);

export const admobOauthCallback = onRequest({ region: REGION, secrets: admobSecrets, maxInstances: 1, timeoutSeconds: 120 }, (req, res) =>
  handleCallback(req, res, ADMOB_OAUTH_CLIENT_ID.value(), ADMOB_OAUTH_CLIENT_SECRET.value()),
);

export const syncAdmob = onSchedule(
  { schedule: 'every 30 minutes', timeZone: 'Asia/Seoul', region: REGION, secrets: admobSecrets, timeoutSeconds: 120, retryCount: 1 },
  async () => {
    await runAdmobSync({ clientId: ADMOB_OAUTH_CLIENT_ID.value(), clientSecret: ADMOB_OAUTH_CLIENT_SECRET.value() });
  },
);

/** Google Play Real-time developer notifications (Pub/Sub topic set in Play Console). */
export const onPlayRtdn = onMessagePublished(
  { topic: 'play-rtdn', region: REGION, retry: true, timeoutSeconds: 60 },
  async (event) => {
    let json: unknown = null;
    try {
      json = event.data.message.json;
    } catch {
      // not JSON: handlePlayRtdn logs and drops it
    }
    await handlePlayRtdn(event.data.message.messageId, json);
  },
);

/**
 * App Store Server Notifications V2 (Production and Sandbox URL in App Store Connect).
 * Public URL: anyone can POST, but only payloads signed by Apple are accepted.
 */
export const appStoreWebhook = onRequest({ region: REGION, timeoutSeconds: 60, maxInstances: 2 }, (req, res) =>
  handleAppStoreWebhook(req, res),
);

/** Daily exchange rates (Frankfurter) → fx/{KST date}. */
export const syncFx = onSchedule({ schedule: 'every day 07:00', timeZone: 'Asia/Seoul', region: REGION, retryCount: 2 }, async () => {
  const rates = await storeTodayRates();
  logger.info('fx stored', { currencies: Object.keys(rates).length });
});

/** Header refresh button: allowlisted users can trigger an AdMob sync right away. */
export const requestSync = onCall({ region: REGION, secrets: admobSecrets, timeoutSeconds: 120, maxInstances: 2 }, (req) =>
  handleRequestSync(req, { clientId: ADMOB_OAUTH_CLIENT_ID.value(), clientSecret: ADMOB_OAUTH_CLIENT_SECRET.value() }),
);

const ascSecrets = [ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY, ASC_VENDOR_NUMBER];

/**
 * Daily correction layer (CLAUDE.md §3). Each store runs on its own; one failing doesn't stop the other.
 * - App Store: Sales report for D-1..D-3 (D-1 is usually not out yet at 04:00 and is picked up next day).
 * - Google Play: Sales report (Cloud Storage, config/app.playReportBucket) for D-1..D-10, only days it fully covers.
 */
export const reconcileDaily = onSchedule(
  { schedule: 'every day 04:00', timeZone: 'Asia/Seoul', region: REGION, secrets: ascSecrets, timeoutSeconds: 300, retryCount: 1 },
  async () => {
    const today = kstDateKey(new Date());
    const errors: string[] = [];
    const warnings: string[] = [];
    const result: Record<string, unknown> = {};

    try {
      const r = await reconcileAppStore(
        { keyId: ASC_KEY_ID.value(), issuerId: ASC_ISSUER_ID.value(), privateKey: ASC_PRIVATE_KEY.value(), vendorNumber: ASC_VENDOR_NUMBER.value() },
        addDays(today, -3),
        addDays(today, -1),
      );
      result.appStore = r.dates;
      if (r.missingFx.length) warnings.push(`App Store 환율 없음: ${r.missingFx.join(', ')}`);
      await recordSyncOk('app_store', { lastReportAt: new Date() });
    } catch (e) {
      logger.error('reconcile: app store failed', { message: (e as Error).message });
      errors.push(appStoreErrorMessage(e));
    }

    const bucket = (await db.doc('config/app').get()).get('playReportBucket');
    if (typeof bucket === 'string' && bucket.trim()) {
      try {
        const r = await reconcileGooglePlay(bucket, addDays(today, -10), addDays(today, -1));
        result.googlePlay = { reconciled: r.reconciled, pending: r.pending };
        if (r.missingFx.length) warnings.push(`Play 환율 없음: ${r.missingFx.join(', ')}`);
        await recordSyncOk('google_play', { lastReportAt: new Date() });
      } catch (e) {
        logger.error('reconcile: google play failed', { message: (e as Error).message });
        errors.push(googlePlayErrorMessage(e));
      }
    } else {
      warnings.push('Play 재무 리포트 버킷(config/app.playReportBucket)이 설정되지 않았습니다.');
    }

    const warning = warnings.length ? warnings.join(' · ') : FieldValue.delete();
    if (errors.length) await recordSyncError('reconcile', errors.join(' · '), { ...result, warning });
    else await recordSyncOk('reconcile', { ...result, warning });
    logger.info('reconcile done', { result, errors: errors.length });
    if (errors.length) throw new Error('reconcile failed'); // let Scheduler retry once
  },
);
