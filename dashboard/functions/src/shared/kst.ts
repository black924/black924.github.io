// All date keys are KST (Asia/Seoul, UTC+9, no DST). Never use new Date() as a date key directly.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

export function kstParts(instant: Date) {
  const s = new Date(instant.getTime() + KST_OFFSET_MS);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate(), hour: s.getUTCHours(), minute: s.getUTCMinutes() };
}

/** YYYY-MM-DD in KST. */
export function kstDateKey(instant: Date): string {
  const p = kstParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function toDateParts(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return { year, month, day };
}

/** "20261110" → "2026-11-10" */
export function fromCompactDate(v: string): string {
  if (!/^\d{8}$/.test(v)) throw new Error(`Unexpected date value: ${v}`);
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

export const hourKey = (dateKey: string, hour: number) => `${dateKey}_${pad(hour)}`;

/**
 * First date the dashboard needs: the earlier of the first day of last month and D-13
 * (same window the web app subscribes to: this month vs last month, 7 days vs previous 7).
 */
export function historyStart(today: string): string {
  const { year, month } = toDateParts(today);
  const py = month === 1 ? year - 1 : year;
  const pm = month === 1 ? 12 : month - 1;
  const lastMonthStart = `${py}-${pad(pm)}-01`;
  const d13 = addDays(today, -13);
  return d13 < lastMonthStart ? d13 : lastMonthStart;
}
