// Money is integer micros. Parse API strings without going through floats when possible.

/** Parses an int64-as-string (or number) micros value into a safe integer. */
export function parseMicros(v: unknown): number {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Non-finite micros');
    return Math.round(v);
  }
  if (typeof v !== 'string') throw new Error(`Unexpected micros value: ${String(v)}`);
  if (/^-?\d+$/.test(v)) {
    const big = BigInt(v);
    if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('Micros out of range');
    return Number(big);
  }
  if (/^-?\d+\.\d+$/.test(v)) return Math.round(Number(v));
  throw new Error(`Unexpected micros value: ${v}`);
}

/** Google `Money` ({currencyCode, units: int64 string, nanos}) → integer micros. Both parts carry the sign. */
export interface Money {
  currencyCode?: string;
  units?: string | number;
  nanos?: number;
}

export function moneyToMicros(m: Money | undefined): number {
  if (!m) return 0;
  const units = BigInt(m.units ?? 0);
  const nanos = BigInt(Math.trunc(m.nanos ?? 0));
  // nanos / 1000 → micros, rounding half away from zero
  const micros = units * 1_000_000n + (nanos >= 0n ? (nanos + 500n) / 1000n : (nanos - 500n) / 1000n);
  return Number(micros);
}

/**
 * Converts micros in a foreign currency to KRW micros with integer math.
 * `krwPerUnit` is a rate like 1350.63 (KRW per 1 unit); it is fixed to 6 decimals first.
 */
export function toKrwMicros(amountMicros: number, krwPerUnit: number): number {
  if (!Number.isFinite(krwPerUnit) || krwPerUnit <= 0) throw new Error('Invalid FX rate');
  const rateMicros = BigInt(Math.round(krwPerUnit * 1_000_000));
  const product = BigInt(amountMicros) * rateMicros;
  const half = 500_000n;
  const q = product >= 0n ? (product + half) / 1_000_000n : (product - half) / 1_000_000n;
  return Number(q);
}
