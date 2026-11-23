// Runs against the Firestore emulator (npm run emulators). Skipped when it is not running.
import { afterAll, describe, expect, it } from 'vitest';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

run('writeStoreDay (emulator)', async () => {
  const { db } = await import('../shared/firestore');
  const { writeStoreDay } = await import('./daily');
  const D = '2020-02-01';
  const ids = ['t_a', 't_b', 't_c'];
  afterAll(async () => Promise.all(ids.map((id) => db.doc(`daily/${D}_${id}`).delete())));

  it('overwrites one store, zeroes apps missing from the report, creates new docs, leaves the other store', async () => {
    const base = { date: D, ad: { totalMicros: 5, bySource: { admob: 5, unity: 0, other: 0 } }, status: 'estimated' };
    await db.doc(`daily/${D}_t_a`).set({ ...base, appId: 't_a', inapp: { google: 100, apple: 7 }, paid: { google: 0, apple: 0 } });
    await db.doc(`daily/${D}_t_b`).set({ ...base, appId: 't_b', inapp: { google: 50, apple: 0 }, paid: { google: 0, apple: 0 } });

    const n = await writeStoreDay('google', D, new Map([['t_a', { inapp: 90, paid: 0 }], ['t_c', { inapp: 0, paid: 3000 }]]), { source: 'sales_report' });
    expect(n).toBe(3);
    const [a, b, c] = await Promise.all(ids.map((id) => db.doc(`daily/${D}_${id}`).get()));
    expect(a.get('inapp')).toEqual({ google: 90, apple: 7 });
    expect(a.get('ad.totalMicros')).toBe(5);
    expect(a.get('reconciled.google.source')).toBe('sales_report');
    expect(b.get('inapp.google')).toBe(0);
    expect(c.get('paid')).toEqual({ google: 3000, apple: 0 });
    expect(c.get('status')).toBe('estimated');
  });
});
