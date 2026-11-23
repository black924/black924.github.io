// Thin AdMob API v1 client. Never logs tokens or raw responses.
import type { AdmobApp } from './report';

const ADMOB = 'https://admob.googleapis.com/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class AdmobAuthError extends Error {}

/** Exchanges the stored refresh token for a short-lived access token. */
export async function accessTokenFromRefresh(refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (body.error === 'invalid_grant') throw new AdmobAuthError('refresh token revoked or expired');
  if (!res.ok || !body.access_token) throw new Error(`Token refresh failed (${res.status} ${body.error ?? ''})`);
  return body.access_token;
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${ADMOB}/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 401 || res.status === 403) throw new AdmobAuthError(`AdMob API ${res.status}`);
  if (!res.ok) throw new Error(`AdMob API ${path.split('?')[0]} failed (${res.status})`);
  return (await res.json()) as T;
}

export interface PublisherAccount {
  name: string; // accounts/pub-...
  publisherId: string;
  reportingTimeZone: string;
  currencyCode: string;
}

/** accounts.list: response key is "account" (singular array) per the docs. */
export async function getAccount(token: string): Promise<PublisherAccount> {
  const body = await get<{ account?: PublisherAccount[] }>(token, 'accounts');
  const acc = body.account?.[0];
  if (!acc) throw new Error('No AdMob account for this Google account');
  return acc;
}

export async function listApps(token: string, account: string): Promise<AdmobApp[]> {
  const apps: AdmobApp[] = [];
  let pageToken = '';
  do {
    const body = await get<{ apps?: any[]; nextPageToken?: string }>(
      token,
      `${account}/apps?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
    );
    for (const a of body.apps ?? []) {
      apps.push({
        appId: a.appId,
        platform: a.platform,
        storeId: a.linkedAppInfo?.appStoreId,
        name: a.linkedAppInfo?.displayName || a.manualAppInfo?.displayName || a.appId,
      });
    }
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return apps;
}

type YMD = { year: number; month: number; day: number };

export const EARNINGS_SPEC = { dimensions: ['DATE', 'APP', 'AD_SOURCE'], metrics: ['ESTIMATED_EARNINGS'] };
// AD_UNIT implies APP (docs: "If AD_UNIT dimension is specified, then APP is included automatically").
export const AD_UNIT_SPEC = {
  dimensions: ['DATE', 'AD_UNIT', 'FORMAT'],
  metrics: ['AD_REQUESTS', 'MATCHED_REQUESTS', 'IMPRESSIONS', 'CLICKS', 'ESTIMATED_EARNINGS'],
};

/** mediationReport.generate with earnings in KRW. */
export async function generateMediationReport(
  token: string,
  account: string,
  start: YMD,
  end: YMD,
  spec: { dimensions: string[]; metrics: string[] } = EARNINGS_SPEC,
): Promise<unknown> {
  const res = await fetch(`${ADMOB}/${account}/mediationReport:generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportSpec: {
        dateRange: { startDate: start, endDate: end },
        dimensions: spec.dimensions,
        metrics: spec.metrics,
        localizationSettings: { currencyCode: 'KRW', languageCode: 'ko-KR' },
        // timeZone omitted: docs say only America/Los_Angeles is accepted; the account default applies.
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401 || res.status === 403) throw new AdmobAuthError(`AdMob report ${res.status}`);
  if (!res.ok) throw new Error(`AdMob report failed (${res.status})`);
  return res.json();
}
