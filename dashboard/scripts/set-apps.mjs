// Upserts web/src/data/apps.json into apps/{id} on a REAL project via the Firestore REST API (gcloud login).
// Usage: node scripts/set-apps.mjs <projectId>
// admobAppId is filled in later by the AdMob sync (milestone 4); fields not in apps.json are kept.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const projectId = process.argv[2];
if (!projectId) {
  console.error('Usage: node scripts/set-apps.mjs <projectId>');
  process.exit(1);
}

const apps = JSON.parse(readFileSync(new URL('../web/src/data/apps.json', import.meta.url), 'utf8'));
const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();

const value = (v) =>
  Array.isArray(v) ? { arrayValue: { values: v.map(value) } } : { stringValue: String(v) };

for (const { id, ...app } of apps) {
  const fields = Object.fromEntries(Object.entries(app).map(([k, v]) => [k, value(v)]));
  const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${f}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/apps/${id}?${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': projectId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    console.error(`apps/${id} failed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  console.log(`apps/${id} ← ${app.name}`);
}
