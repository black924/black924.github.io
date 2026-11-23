// Writes config/app on a REAL project via the Firestore REST API, using your gcloud login.
// Usage: ALLOWED_EMAILS="you@gmail.com" node scripts/set-allowlist.mjs <projectId>
import { execFileSync } from 'node:child_process';

const projectId = process.argv[2];
const allowedEmails = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (!projectId || allowedEmails.length === 0) {
  console.error('Usage: ALLOWED_EMAILS="you@gmail.com" node scripts/set-allowlist.mjs <projectId>');
  process.exit(1);
}

const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
const fields = {
  allowedEmails: { arrayValue: { values: allowedEmails.map((e) => ({ stringValue: e })) } },
  timezone: { stringValue: 'Asia/Seoul' },
  revenueBasis: { stringValue: 'gross' },
  baseCurrency: { stringValue: 'KRW' },
};
const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${f}`).join('&');
const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/config/app?${mask}`;

const res = await fetch(url, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': projectId, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields }),
  signal: AbortSignal.timeout(20_000),
});
if (!res.ok) {
  console.error(`Failed (${res.status}): ${await res.text()}`);
  process.exit(1);
}
console.log(`config/app updated on ${projectId} (${allowedEmails.length} email(s)).`);
