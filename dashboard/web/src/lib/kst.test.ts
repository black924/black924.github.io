import { describe, expect, it } from 'vitest';
import { addDays, hhmm, kstDateKey, kstLongDate, kstParts, kstStartOfDay } from './kst';

describe('kst', () => {
  it('rolls over to the next KST day at 15:00 UTC', () => {
    expect(kstDateKey(new Date('2026-11-09T14:59:59Z'))).toBe('2026-11-09');
    expect(kstDateKey(new Date('2026-11-09T15:00:00Z'))).toBe('2026-11-10');
  });

  it('handles year boundary', () => {
    expect(kstDateKey(new Date('2026-12-31T15:30:00Z'))).toBe('2027-01-01');
  });

  it('returns KST hour', () => {
    expect(kstParts(new Date('2026-11-10T00:30:00Z')).hour).toBe(9);
    expect(hhmm(new Date('2026-11-10T00:05:00Z'))).toBe('09:05');
  });

  it('computes start of KST day', () => {
    expect(kstStartOfDay(new Date('2026-11-10T03:00:00Z')).toISOString()).toBe('2026-11-09T15:00:00.000Z');
  });

  it('adds days across months and leap years', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('formats long date with weekday', () => {
    expect(kstLongDate(new Date('2026-11-10T01:00:00Z'))).toBe('2026년 11월 10일 (화)');
  });
});
