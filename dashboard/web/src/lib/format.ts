// Money is stored as integer micros (1 KRW = 1,000,000 micros).
export const MICROS_PER_UNIT = 1_000_000;

const krw = new Intl.NumberFormat('ko-KR');

/** Integer won, rounded half away from zero, computed without float multiplication. */
export function microsToWon(micros: number): number {
  const sign = micros < 0 ? -1 : 1;
  const abs = Math.abs(micros);
  const whole = Math.floor(abs / MICROS_PER_UNIT);
  const rem = abs - whole * MICROS_PER_UNIT;
  return sign * (rem * 2 >= MICROS_PER_UNIT ? whole + 1 : whole);
}

/** "₩1,234" */
export function formatKrw(micros: number): string {
  const won = microsToWon(micros);
  return `${won < 0 ? '-' : ''}₩${krw.format(Math.abs(won))}`;
}

/** Compact axis label: "12만", "1.2억", "8,000". */
export function formatKrwCompact(micros: number): string {
  const won = microsToWon(micros);
  const abs = Math.abs(won);
  if (abs >= 100_000_000) return `${trim(won / 100_000_000)}억`;
  if (abs >= 10_000) return `${trim(won / 10_000)}만`;
  return krw.format(won);
}

function trim(n: number): string {
  return n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
}

/** Percent change; null when there is no baseline. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/** Share of part in whole as 0-100. */
export function share(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

/** "방금", "3분 전", "2시간 전", "1일 전" */
export function relativeTime(from: Date, now: Date): string {
  const sec = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}
