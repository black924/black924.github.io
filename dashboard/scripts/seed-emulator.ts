// Fills the local Firestore emulator with sample data in the CLAUDE.md §4 shape.
// Usage: ALLOWED_EMAILS="you@gmail.com" npm run seed
import { Timestamp } from 'firebase-admin/firestore';
import { db, emulatorHost, EMULATOR_PROJECT } from './emulatorDb';
import { generateSeed } from '../web/src/data/seed';

const allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
if (allowedEmails.length === 0) {
  console.error('Set ALLOWED_EMAILS, e.g. ALLOWED_EMAILS="you@gmail.com" npm run seed');
  process.exit(1);
}

// Start clean so re-seeding is idempotent (emulator-only endpoint).
await fetch(`http://${emulatorHost}/emulator/v1/projects/${EMULATOR_PROJECT}/databases/(default)/documents`, { method: 'DELETE' });

const now = new Date();
const seed = generateSeed(now);
const ts = (d: Date) => Timestamp.fromDate(d);
const pad = (n: number) => String(n).padStart(2, '0');
const w = db.bulkWriter();

w.set(db.doc('config/app'), { allowedEmails, timezone: 'Asia/Seoul', revenueBasis: 'gross', baseCurrency: 'KRW' });
for (const { id, ...app } of seed.apps) w.set(db.doc(`apps/${id}`), app);
for (const d of seed.daily) w.set(db.doc(`daily/${d.date}_${d.appId}`), { ...d, updatedAt: ts(now) });
for (const h of seed.hourly) w.set(db.doc(`hourly/${h.date}_${pad(h.hour)}`), h);
for (const { id, occurredAt, ...t } of seed.transactions) w.set(db.doc(`transactions/${id}`), { ...t, occurredAt: ts(occurredAt) });
for (const [store, active] of Object.entries(seed.subscribers)) w.set(db.doc(`subscribers/${store}`), { active, updatedAt: ts(now) });
for (const { source, lastRunAt, ...s } of seed.sync) w.set(db.doc(`sync/${source}`), { ...s, lastRunAt: ts(lastRunAt) });
if (seed.fx) w.set(db.doc(`fx/${seed.fx.date}`), seed.fx.rates);
await w.close();

console.log(
  `Seeded emulator: ${seed.apps.length} apps, ${seed.daily.length} daily, ${seed.hourly.length} hourly, ` +
    `${seed.transactions.length} transactions; allowlist ${allowedEmails.length} email(s).`,
);
