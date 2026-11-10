// Pushes a fake payment into the emulator every 15–30s, writing the same documents the
// Play RTDN / App Store webhook functions will write (transactions + daily + hourly + sync).
// Usage: npm run simulate   (Ctrl+C to stop)
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './emulatorDb';
import { makeTransaction, transactionTarget } from '../web/src/data/seed';

let n = 0;

async function pushOne() {
  n += 1;
  const at = new Date();
  const tx = makeTransaction(`sim-${at.getTime()}`, at, n % 7 === 0);
  const { date, hour, dailyId, category } = transactionTarget(tx);
  const inc = FieldValue.increment(tx.amountKrwMicros);
  const batch = db.batch();
  const { id, occurredAt, ...rest } = tx;
  batch.set(db.doc(`transactions/${id}`), { ...rest, occurredAt: Timestamp.fromDate(occurredAt) });
  batch.set(
    db.doc(`daily/${dailyId}`),
    { date, appId: tx.appId, status: 'estimated', [category]: { [tx.store]: inc }, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  batch.set(db.doc(`hourly/${date}_${String(hour).padStart(2, '0')}`), { date, hour, [category]: inc }, { merge: true });
  batch.set(db.doc(`sync/${tx.store === 'google' ? 'google_play' : 'app_store'}`), { state: 'ok', lastRunAt: Timestamp.fromDate(at) }, { merge: true });
  await batch.commit();
  const won = new Intl.NumberFormat('ko-KR').format(tx.amountKrwMicros / 1_000_000);
  console.log(`${at.toLocaleTimeString('ko-KR')}  ${tx.store === 'google' ? 'GP' : 'AS'}  ${tx.appId}  ${tx.type}  ₩${won}`);
}

console.log('Simulating payments into the emulator. Ctrl+C to stop.');
for (;;) {
  await pushOne();
  await new Promise((r) => setTimeout(r, 15_000 + Math.random() * 15_000));
}
