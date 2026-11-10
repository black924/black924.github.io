import { onRequest } from 'firebase-functions/v2/https';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { logger } from 'firebase-functions';
import { storeTodayRates } from './fx/rates';
import { handlePlayRtdn } from './googlePlay/handler';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { handleCallback, handleStart } from './admob/oauth';
import { runAdmobSync } from './admob/sync';
import { REGION } from './shared/region';
import { ADMOB_OAUTH_CLIENT_ID, ADMOB_OAUTH_CLIENT_SECRET } from './shared/secrets';

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

/** Daily exchange rates (Frankfurter) → fx/{KST date}. */
export const syncFx = onSchedule({ schedule: 'every day 07:00', timeZone: 'Asia/Seoul', region: REGION, retryCount: 2 }, async () => {
  const rates = await storeTodayRates();
  logger.info('fx stored', { currencies: Object.keys(rates).length });
});
