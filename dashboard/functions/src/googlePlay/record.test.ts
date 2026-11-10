// Runs against the Firestore emulator (npm run emulators). Skipped when it is not running.
import { afterAll, describe, expect, it } from 'vitest';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { recordPlayTransaction, type PlayTransaction } from './record';

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
      'rtdnEvents/m1', 'rtdnEvents/m2', 'rtdnEvents/m3',
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
});
