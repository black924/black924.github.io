// Runs against the Firestore emulator (npm run emulators). Skipped when it is not running.
import { afterAll, describe, expect, it } from 'vitest';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { recordPlayTransaction, recordStoreTransaction, type PlayTransaction } from './record';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const run = host ? describe : describe.skip;

run('recordPlayTransaction (emulator)', () => {
  const app = initializeApp({ projectId: 'demo-hnh-dashboard' }, 'record-test');
  const db = getFirestore(app);
  const at = new Date('2020-01-01T03:00:00Z'); // 2020-01-01 12:00 KST, far from real data
  const base: PlayTransaction = {
    id: 'gp_TEST.order.1',
    appId: 'test_app',
    productId: 'p',
    productName: 'P',
    type: 'inapp',
    orderId: 'TEST.order.1',
    currency: 'KRW',
    amountMicros: 4_400_000_000,
    amountKrwMicros: 4_400_000_000,
    occurredAt: at,
  };
  const daily = () => db.doc('daily/2020-01-01_test_app').get();

  afterAll(async () => {
    const refs = [
      'daily/2020-01-01_test_app', 'hourly/2020-01-01_12', 'transactions/gp_TEST.order.1', 'transactions/gp_refund_TEST',
      'rtdnEvents/m1', 'rtdnEvents/m2', 'rtdnEvents/m3', 'rtdnEvents/m4', 'transactions/gp_TEST.test.1',
      'asnEvents/a1', 'transactions/as_TEST.1', 'daily/2020-01-01_test_ios',
    ];
    await Promise.all(refs.map((r) => db.doc(r).delete()));
  });

  it('records once, then ignores the same message and a second message for the same order', async () => {
    expect(await recordPlayTransaction(db, 'm1', base)).toBe('recorded');
    expect(await recordPlayTransaction(db, 'm1', base)).toBe('duplicate-message');
    expect(await recordPlayTransaction(db, 'm2', base)).toBe('duplicate-order');
    const d = await daily();
    expect(d.get('inapp.google')).toBe(4_400_000_000);
    expect(d.get('status')).toBe('estimated');
    expect((await db.doc('hourly/2020-01-01_12').get()).get('inapp')).toBe(4_400_000_000);
  });

  it('subtracts a refund from the same day', async () => {
    const refund = { ...base, id: 'gp_refund_TEST', type: 'refund' as const, amountMicros: -4_400_000_000, amountKrwMicros: -4_400_000_000 };
    expect(await recordPlayTransaction(db, 'm3', refund)).toBe('recorded');
    expect((await daily()).get('inapp.google')).toBe(0);
  });

  it('records a test purchase in transactions only, leaving revenue untouched', async () => {
    const test = { ...base, id: 'gp_TEST.test.1', orderId: 'TEST.test.1', test: true };
    expect(await recordPlayTransaction(db, 'm4', test)).toBe('recorded');
    expect((await db.doc('transactions/gp_TEST.test.1').get()).get('test')).toBe(true);
    expect((await daily()).get('inapp.google')).toBe(0);
    expect((await db.doc('hourly/2020-01-01_12').get()).get('inapp')).toBe(0);
  });

  it('records App Store payments under inapp.apple with store and source', async () => {
    const tx = { ...base, id: 'as_TEST.1', appId: 'test_ios', orderId: 'TEST.1', amountKrwMicros: 1_100_000_000 };
    expect(await recordStoreTransaction(db, { store: 'apple', source: 'asn', eventPath: 'asnEvents/a1' }, tx)).toBe('recorded');
    const t = await db.doc('transactions/as_TEST.1').get();
    expect([t.get('store'), t.get('source')]).toEqual(['apple', 'asn']);
    const d = await db.doc('daily/2020-01-01_test_ios').get();
    expect(d.get('inapp')).toEqual({ google: 0, apple: 1_100_000_000 });
    expect((await db.doc('hourly/2020-01-01_12').get()).get('inapp')).toBe(1_100_000_000);
  });
});
