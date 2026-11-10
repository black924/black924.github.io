import { logger } from 'firebase-functions';
import { krwPerUnit } from '../fx/rates';
import { db } from '../shared/firestore';
import { kstDateKey } from '../shared/kst';
import { toKrwMicros } from '../shared/money';
import { recordSyncError, recordSyncOk } from '../shared/sync';
import { orderAmounts, refundedGrossMicros } from './amounts';
import { PlayApiError, getOrder, getProduct, getSubscription, type Order } from './api';
import { classify, decodeNotification, orderDocId } from './notification';
import { recordPlayTransaction, type PlayTransaction } from './record';

const MSG_PERMISSION = 'Google Play API 권한이 없습니다. Play Console에서 서비스 계정 권한을 확인해 주세요. 권한이 생기면 밀린 알림을 자동으로 다시 처리합니다.';
const MSG_FAILED = 'Google Play 결제 알림 처리 중 오류가 났습니다. 자동으로 다시 시도합니다.';

async function appIdFor(packageName: string): Promise<string> {
  const snap = await db.collection('apps').where('playPackage', '==', packageName).limit(1).get();
  return snap.empty ? `gp_${packageName.replace(/[^A-Za-z0-9_-]/g, '_')}` : snap.docs[0].id;
}

async function toKrw(micros: number, currency: string, at: Date) {
  return currency === 'KRW' ? micros : toKrwMicros(micros, await krwPerUnit(currency, kstDateKey(at)));
}

async function chargeTransaction(appId: string, orderId: string, type: 'subscription' | 'inapp', productId: string, order: Order) {
  const { currency, grossMicros, netMicros } = orderAmounts(order);
  const occurredAt = order.createTime ? new Date(order.createTime) : new Date();
  const line = order.lineItems?.[0];
  const tx: PlayTransaction = {
    id: orderDocId('gp', orderId),
    appId,
    productId: line?.productId ?? productId,
    productName: line?.productTitle || line?.productId || productId,
    type,
    orderId,
    currency,
    amountMicros: grossMicros,
    amountKrwMicros: await toKrw(grossMicros, currency, occurredAt),
    netMicros,
    netKrwMicros: await toKrw(netMicros, currency, occurredAt),
    occurredAt,
  };
  return tx;
}

/**
 * Handles one Pub/Sub message. Throws only for retryable problems so Pub/Sub redelivers it;
 * the rtdnEvents marker makes redelivery safe.
 */
export async function handlePlayRtdn(messageId: string, json: unknown): Promise<void> {
  let n;
  try {
    n = decodeNotification(json);
  } catch {
    logger.warn('play rtdn: undecodable message', { messageId });
    return;
  }
  const action = classify(n);
  const pkg = n.packageName;

  try {
    if (action.kind === 'test') {
      logger.info('play rtdn: test notification', { pkg });
      await recordSyncOk('google_play', { lastTestAt: new Date() });
      return;
    }
    if (action.kind === 'ignore') {
      logger.info('play rtdn: ignored', { pkg, reason: action.reason });
      await recordSyncOk('google_play');
      return;
    }

    const appId = await appIdFor(pkg);
    let tx: PlayTransaction | null = null;

    if (action.kind === 'subscriptionCharge') {
      const sub = await getSubscription(pkg, action.token);
      if (sub.testPurchase) return void logger.info('play rtdn: test subscription skipped', { pkg });
      const item = sub.lineItems?.find((l) => l.latestSuccessfulOrderId) ?? sub.lineItems?.[0];
      const orderId = item?.latestSuccessfulOrderId ?? sub.latestOrderId;
      if (!orderId) return void logger.warn('play rtdn: subscription without order id', { pkg });
      tx = await chargeTransaction(appId, orderId, 'subscription', item?.productId ?? '', await getOrder(pkg, orderId));
    } else if (action.kind === 'inappCharge') {
      const p = await getProduct(pkg, action.sku, action.token);
      if (p.purchaseState !== 0) return void logger.info('play rtdn: not purchased yet', { pkg, state: p.purchaseState });
      if (p.purchaseType === 0) return void logger.info('play rtdn: test purchase skipped', { pkg });
      if (!p.orderId) return void logger.info('play rtdn: purchase without order (promo/rewarded)', { pkg });
      tx = await chargeTransaction(appId, p.orderId, 'inapp', action.sku, await getOrder(pkg, p.orderId));
    } else {
      // Refund: record the amount refunded since the last refund we recorded for this order.
      const order = await getOrder(pkg, action.orderId);
      const { currency } = orderAmounts(order);
      const refunded = refundedGrossMicros(order);
      const prior = await db.collection('transactions').where('orderId', '==', action.orderId).where('type', '==', 'refund').get();
      const already = prior.docs.reduce((a, d) => a + Math.abs(d.get('amountMicros') ?? 0), 0);
      let delta = refunded - already;
      if (refunded === 0 && !action.partial && already === 0) {
        // Order history not updated yet: assume a full refund of the original payment.
        delta = orderAmounts(order).grossMicros;
      }
      if (delta <= 0) return void logger.info('play rtdn: refund already recorded', { pkg });
      const occurredAt = new Date(Number(n.eventTimeMillis) || Date.now());
      const line = order.lineItems?.[0];
      tx = {
        id: orderDocId('gp_refund', `${action.orderId}_${n.eventTimeMillis}`),
        appId,
        productId: line?.productId ?? '',
        productName: line?.productTitle || line?.productId || '',
        type: 'refund',
        orderId: action.orderId,
        currency,
        amountMicros: -delta,
        amountKrwMicros: -(await toKrw(delta, currency, occurredAt)),
        occurredAt,
      };
    }

    const result = await recordPlayTransaction(db, messageId, tx);
    logger.info('play rtdn: processed', { pkg, kind: action.kind, result });
    await recordSyncOk('google_play');
  } catch (e) {
    if (e instanceof PlayApiError) {
      logger.error('play rtdn: api error', { pkg, status: e.status });
      await recordSyncError('google_play', e.status === 401 || e.status === 403 ? MSG_PERMISSION : MSG_FAILED);
      if (e.retryable) throw e;
      return; // bad token or unknown order: retrying will not help
    }
    logger.error('play rtdn: failed', { pkg, message: (e as Error).message });
    await recordSyncError('google_play', MSG_FAILED);
    throw e;
  }
}
