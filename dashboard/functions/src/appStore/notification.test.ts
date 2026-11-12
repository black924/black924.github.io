import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VerificationException } from '@apple/app-store-server-library';
import type { JWSTransactionDecodedPayload } from '@apple/app-store-server-library';
import { verifyAsn } from './handler';
import { chargeMicros, classifyAsn, isSandbox, peekPayload, refundMicros, transactionDocId, transactionKind } from './notification';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const body = (environment: string) => ({
  notificationType: 'ONE_TIME_CHARGE',
  notificationUUID: 'uuid-1',
  signedDate: 1762750000000,
  data: { bundleId: 'com.menew.noiseanalyzer', environment, appAppleId: 6823575453 },
});

/** A JWS signed with our own key, claiming to be from Apple. */
function forged(environment: string, x5c?: string[]) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const head = b64({ alg: 'ES256', ...(x5c ? { x5c } : {}) });
  const payload = b64(body(environment));
  const sig = sign('sha256', Buffer.from(`${head}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${head}.${payload}.${sig.toString('base64url')}`;
}

describe('verifyAsn rejects anything not signed by Apple', () => {
  const appleRoot = readFileSync(join(__dirname, '../../certs/AppleRootCA-G3.cer')).toString('base64');

  it('rejects a payload without a certificate chain', async () => {
    await expect(verifyAsn(forged('Sandbox'), false)).rejects.toBeInstanceOf(VerificationException);
  });
  it('rejects a self-signed payload that only names Apple certificates', async () => {
    await expect(verifyAsn(forged('Production', [appleRoot, appleRoot, appleRoot]), false)).rejects.toBeInstanceOf(VerificationException);
  });
  it('rejects a tampered payload', async () => {
    const [h, , s] = forged('Sandbox', [appleRoot, appleRoot, appleRoot]).split('.');
    await expect(verifyAsn(`${h}.${b64({ ...body('Sandbox'), notificationType: 'REFUND' })}.${s}`, false)).rejects.toBeInstanceOf(VerificationException);
  });
  it('refuses Xcode/local-testing payloads and junk', async () => {
    await expect(verifyAsn(forged('Xcode'), false)).rejects.toThrow(/Unsupported/);
    await expect(verifyAsn('not-a-jws', false)).rejects.toThrow();
  });
});

describe('classifyAsn', () => {
  it('maps money-moving notifications', () => {
    expect(classifyAsn({ notificationType: 'TEST' }).kind).toBe('test');
    for (const t of ['SUBSCRIBED', 'DID_RENEW', 'ONE_TIME_CHARGE']) expect(classifyAsn({ notificationType: t }).kind).toBe('charge');
    expect(classifyAsn({ notificationType: 'REFUND' }).kind).toBe('refund');
    expect(classifyAsn({ notificationType: 'EXPIRED', subtype: 'VOLUNTARY' })).toEqual({ kind: 'ignore', reason: 'EXPIRED/VOLUNTARY' });
    expect(classifyAsn({ notificationType: 'DID_FAIL_TO_RENEW' }).kind).toBe('ignore');
  });
});

describe('amounts', () => {
  const tx = (o: Partial<JWSTransactionDecodedPayload>): JWSTransactionDecodedPayload => ({ price: 4_400_000, currency: 'KRW', ...o });

  it('converts milliunits to micros and multiplies by quantity', () => {
    expect(chargeMicros(tx({}))).toBe(4_400_000_000); // ₩4,400
    expect(chargeMicros(tx({ price: 990, currency: 'USD', quantity: 2 }))).toBe(1_980_000); // $0.99 × 2
    expect(chargeMicros(tx({ price: undefined }))).toBe(0);
  });
  it('refunds the revoked percentage, full when absent', () => {
    expect(refundMicros(tx({}))).toBe(4_400_000_000);
    expect(refundMicros(tx({ revocationPercentage: 50_000 }))).toBe(2_200_000_000);
  });
  it('tells subscriptions from one-time purchases', () => {
    expect(transactionKind(tx({ type: 'Auto-Renewable Subscription' }))).toBe('subscription');
    expect(transactionKind(tx({ type: 'Consumable' }))).toBe('inapp');
  });
});

describe('helpers', () => {
  it('peeks at the claimed app and environment', () => {
    expect(peekPayload(forged('Sandbox'))).toEqual({ bundleId: 'com.menew.noiseanalyzer', environment: 'Sandbox', appAppleId: 6823575453 });
  });
  it('marks sandbox as test', () => {
    expect(isSandbox('Sandbox')).toBe(true);
    expect(isSandbox('Production')).toBe(false);
  });
  it('builds safe document ids', () => {
    expect(transactionDocId('as', '2000000123/4')).toBe('as_2000000123_4');
  });
});
