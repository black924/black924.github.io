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
 * Daily correction layer (CLAUDE.md §3): App Store Sales report for D-1..D-3 overwrites the notification
 * estimates. D-1 is usually not published yet at 04:00 KST and is picked up the next day.
 * TODO: Google Play financial report.
 */
export const reconcileDaily = onSchedule(
  { schedule: 'every day 04:00', timeZone: 'Asia/Seoul', region: REGION, secrets: ascSecrets, timeoutSeconds: 300, retryCount: 1 },
  async () => {
    const today = kstDateKey(new Date());
    try {
      const r = await reconcileAppStore(
        { keyId: ASC_KEY_ID.value(), issuerId: ASC_ISSUER_ID.value(), privateKey: ASC_PRIVATE_KEY.value(), vendorNumber: ASC_VENDOR_NUMBER.value() },
        addDays(today, -3),
        addDays(today, -1),
      );
      const warning = r.missingFx.length ? `환율이 없어 제외한 통화: ${r.missingFx.join(', ')}` : FieldValue.delete();
      await recordSyncOk('reconcile', { appStore: r.dates, warning });
      await recordSyncOk('app_store', { lastReportAt: new Date() });
      logger.info('reconcile done', r);
    } catch (e) {
      logger.error('reconcile: app store failed', { message: (e as Error).message });
      await recordSyncError('reconcile', appStoreErrorMessage(e));
      throw e; // let Scheduler retry once
    }
  },
);
