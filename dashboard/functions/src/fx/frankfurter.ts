// Frankfurter v2: GET https://api.frankfurter.dev/v2/rates?base=usd → [{date, base, quote, rate}]
// (response shape checked against the live API on 2026-11-10; the docs only show requests).
export const FRANKFURTER_URL = 'https://api.frankfurter.dev/v2/rates?base=usd';

export interface FxRates {
  rateDate: string; // date of the KRW quote
  krwPer: Record<string, number>; // KRW per 1 unit of each currency
}

/** USD-based quotes → KRW per unit for every currency (cross rate through USD). */
export function parseFrankfurter(body: unknown): FxRates {
  if (!Array.isArray(body)) throw new Error('Unexpected FX response');
  const usdTo = new Map<string, { rate: number; date: string }>();
  for (const r of body as { date?: string; base?: string; quote?: string; rate?: number }[]) {
    if (r.base?.toUpperCase() !== 'USD' || !r.quote || typeof r.rate !== 'number' || r.rate <= 0) continue;
    usdTo.set(r.quote.toUpperCase(), { rate: r.rate, date: r.date ?? '' });
  }
  const krw = usdTo.get('KRW');
  if (!krw) throw new Error('FX response has no KRW quote');
  const krwPer: Record<string, number> = { USD: krw.rate, KRW: 1 };
  for (const [cur, { rate }] of usdTo) {
    if (cur !== 'KRW') krwPer[cur] = Math.round((krw.rate / rate) * 1e6) / 1e6;
  }
  return { rateDate: krw.date, krwPer };
}

export async function fetchFrankfurter(): Promise<FxRates> {
  const res = await fetch(FRANKFURTER_URL, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Frankfurter failed (${res.status})`);
  return parseFrankfurter(await res.json());
}
