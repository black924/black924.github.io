// App Store Connect API client: JWT auth, app list and daily Sales reports.
// Docs: developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests,
//       .../get-v1-salesreports, .../get-v1-apps
import { createPrivateKey, sign } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const BASE = 'https://api.appstoreconnect.apple.com';

export interface AscCredentials {
  keyId: string;
  issuerId: string;
  privateKey: string; // .p8 file contents (PEM)
  vendorNumber: string;
}

/** ES256 JWT for a team key. Apple rejects tokens that expire more than 20 minutes out. */
export function ascToken(c: Pick<AscCredentials, 'keyId' | 'issuerId' | 'privateKey'>, now = Date.now()): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(now / 1000);
  const input = `${enc({ alg: 'ES256', kid: c.keyId, typ: 'JWT' })}.${enc({ iss: c.issuerId, iat, exp: iat + 15 * 60, aud: 'appstoreconnect-v1' })}`;
  // Secret Manager values pasted on one line may carry literal "\n".
  const key = createPrivateKey(c.privateKey.includes('\\n') ? c.privateKey.replace(/\\n/g, '\n') : c.privateKey);
  const sig = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

async function get(path: string, token: string, accept = 'application/json'): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept },
    signal: AbortSignal.timeout(30_000),
  });
}

/** App SKU → bundle id for every app in the account. */
export async function listAppSkus(token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let next: string | null = '/v1/apps?fields[apps]=sku,bundleId&limit=200';
  while (next) {
    const res = await get(next, token);
    if (!res.ok) throw new AscError(res.status, `apps list failed (${res.status})`);
    const body = (await res.json()) as { data: { attributes: { sku?: string; bundleId?: string } }[]; links?: { next?: string } };
    for (const a of body.data) if (a.attributes.sku && a.attributes.bundleId) map.set(a.attributes.sku, a.attributes.bundleId);
    next = body.links?.next ? body.links.next.replace(BASE, '') : null;
  }
  return map;
}

export type SalesReportResult = { kind: 'report'; tsv: string } | { kind: 'missing'; noSales: boolean };

/**
 * Daily Summary Sales report for `date` (YYYY-MM-DD, Apple's report day).
 * 404 means there is no report: either no sales that day or not generated yet.
 * TODO(verify): Apple doesn't document the 404; its detail text is commonly "There were no sales for the date specified."
 */
export async function fetchDailySales(c: AscCredentials, token: string, date: string): Promise<SalesReportResult> {
  const q = new URLSearchParams({
    'filter[frequency]': 'DAILY',
    'filter[reportType]': 'SALES',
    'filter[reportSubType]': 'SUMMARY',
    'filter[vendorNumber]': c.vendorNumber,
    'filter[reportDate]': date,
    'filter[version]': '1_0',
  });
  const res = await get(`/v1/salesReports?${q}`, token, 'application/a-gzip');
  if (res.status === 404) {
    const text = await res.text().catch(() => '');
    return { kind: 'missing', noSales: /no sales/i.test(text) };
  }
  if (!res.ok) throw new AscError(res.status, `sales report failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const raw = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
  return { kind: 'report', tsv: raw.toString('utf8') };
}

export class AscError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
