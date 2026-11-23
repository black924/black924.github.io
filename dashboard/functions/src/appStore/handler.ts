// App Store Server Notifications V2 webhook. Every payload is verified against Apple's root certificate
// with @apple/app-store-server-library before anything is read from it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Environment, SignedDataVerifier, VerificationException,
  type JWSTransactionDecodedPayload, type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';
import { logger } from 'firebase-functions';
import type { Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import { toKrwAt } from '../fx/rates';
import { recordStoreTransaction, type StoreTransaction } from '../googlePlay/record';
import { db } from '../shared/firestore';
import { recordSyncError, recordSyncOk } from '../shared/sync';
import { chargeMicros, classifyAsn, isSandbox, peekPayload, refundMicros, transactionDocId, transactionKind } from './notification';

const MSG_FAILED = 'App Store 결제 알림 처리 중 오류가 났습니다. Apple이 자동으로 다시 보냅니다.';

// Apple Root CA - G3 signs the App Store JWS chain (G2 kept in case Apple rotates).
let rootCerts: Buffer[] | null = null;
const certs = () =>
  (rootCerts ??= ['AppleRootCA-G3.cer', 'AppleRootCA-G2.cer'].map((f) => readFileSync(join(__dirname, '../../certs', f))));

export interface VerifiedAsn {
  notification: ResponseBodyV2DecodedPayload;
  transaction: JWSTransactionDecodedPayload | null;
  environment: Environment;
  bundleId: string;
}

/**
 * Verifies the signed payload (and its signed transaction) for the app and environment it names.
 * The verifier also checks that the bundle id, app id and environment inside the verified payload match.
 * Throws VerificationException (or Error for malformed input).
 */
export async function verifyAsn(signedPayload: string, onlineChecks = true): Promise<VerifiedAsn> {
  const claimed = peekPayload(signedPayload);
  const environment =
    claimed.environment === Environment.PRODUCTION ? Environment.PRODUCTION
      : claimed.environment === Environment.SANDBOX ? Environment.SANDBOX
        : null;
  if (!environment || !claimed.bundleId) throw new Error(`Unsupported environment or bundle: ${claimed.environment}`);
  const appAppleId = environment === Environment.PRODUCTION ? claimed.appAppleId : undefined;
  const verifier = new SignedDataVerifier(certs(), onlineChecks, environment, claimed.bundleId, appAppleId);
  const notification = await verifier.verifyAndDecodeNotification(signedPayload);
  const signedTx = notification.data?.signedTransactionInfo;
  const transaction = signedTx ? await verifier.verifyAndDecodeTransaction(signedTx) : null;
  return { notification, transaction, environment, bundleId: claimed.bundleId };
}

async function appIdFor(bundleId: string): Promise<string> {
  const snap = await db.collection('apps').where('appStoreBundleId', '==', bundleId).limit(1).get();
  return snap.empty ? `as_${bundleId.replace(/[^A-Za-z0-9_-]/g, '_')}` : snap.docs[0].id;
}

export async function handleAppStoreWebhook(req: Request, res: Response): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).send('POST only');
    return;
  }
  const signedPayload = (req.body as { signedPayload?: unknown } | undefined)?.signedPayload;
  if (typeof signedPayload !== 'string') {
    res.status(400).send('signedPayload required');
    return;
  }

  let v: VerifiedAsn;
  try {
    v = await verifyAsn(signedPayload);
  } catch (e) {
    // Not from Apple (or not for one of our apps): reject without touching Firestore.
    const status = e instanceof VerificationException ? e.status : (e as Error).message;
    logger.warn('asn: verification failed', { status });
    res.status(400).send('invalid');
    return;
  }

  const n = v.notification;
  const action = classifyAsn(n);
  try {
    if (action.kind === 'test') {
      logger.info('asn: test notification', { bundleId: v.bundleId, environment: v.environment });
      await recordSyncOk('app_store', { lastTestAt: new Date() });
      res.status(200).send('ok');
      return;
    }
    if (action.kind === 'ignore' || !v.transaction?.transactionId || !n.notificationUUID) {
      logger.info('asn: ignored', { bundleId: v.bundleId, reason: action.kind === 'ignore' ? action.reason : 'no transaction' });
      await recordSyncOk('app_store');
      res.status(200).send('ok');
      return;
    }

    const t = v.transaction;
    const test = isSandbox(v.environment);
    const currency = (t.currency ?? 'KRW').toUpperCase();
    const refund = action.kind === 'refund';
    const micros = refund ? refundMicros(t) : chargeMicros(t);
    if (!refund && micros <= 0 && !test) {
      logger.info('asn: free transaction skipped', { bundleId: v.bundleId, offer: t.offerDiscountType });
      await recordSyncOk('app_store');
      res.status(200).send('ok');
      return;
    }
    const occurredAt = new Date((refund ? t.revocationDate : t.purchaseDate) ?? n.signedDate ?? Date.now());
    const krw = await toKrwAt(micros, currency, occurredAt);
    const tx: StoreTransaction = {
      id: transactionDocId(refund ? 'as_refund' : 'as', t.transactionId!),
      appId: await appIdFor(v.bundleId),
      productId: t.productId ?? '',
      productName: t.productId ?? '',
      type: refund ? 'refund' : transactionKind(t),
      orderId: t.transactionId!,
      currency,
      amountMicros: refund ? -micros : micros,
      amountKrwMicros: refund ? -krw : krw,
      occurredAt,
      ...(test ? { test: true } : {}),
    };
    const result = await recordStoreTransaction(db, { store: 'apple', source: 'asn', eventPath: `asnEvents/${n.notificationUUID}` }, tx);
    logger.info('asn: processed', { bundleId: v.bundleId, type: n.notificationType, result, test });
    await recordSyncOk('app_store');
    res.status(200).send('ok');
  } catch (e) {
    // Non-200 makes Apple resend later; the asnEvents marker keeps that safe.
    logger.error('asn: failed', { message: (e as Error).message });
    await recordSyncError('app_store', MSG_FAILED).catch(() => undefined);
    res.status(500).send('error');
  }
}
