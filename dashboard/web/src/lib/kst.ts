// All date keys and boundaries are computed in Asia/Seoul (UTC+9, no DST).
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface KstParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

export function kstParts(instant: Date): KstParts {
  const shifted = new Date(instant.getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD in KST. */
export function kstDateKey(instant: Date): string {
  const p = kstParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The instant at 00:00 KST of the KST day containing `instant`. */
export function kstStartOfDay(instant: Date): Date {
  const p = kstParts(instant);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - KST_OFFSET_MS);
}

/** Shift a date key by whole days. */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function hhmm(instant: Date): string {
  const p = kstParts(instant);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** e.g. "2026년 11월 10일 (화)" */
export function kstLongDate(instant: Date): string {
  const p = kstParts(instant);
  const wd = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return `${p.year}년 ${p.month}월 ${p.day}일 (${WEEKDAYS[wd]})`;
}

/** "11/4" from a date key. */
export function shortDay(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number);
  return `${m}/${d}`;
}
