import { describe, expect, it } from 'vitest';
import { formatKrw, formatKrwCompact, microsToWon, percentChange, relativeTime } from './format';

describe('format', () => {
  it('converts micros to won with half-up rounding', () => {
    expect(microsToWon(1_234_000_000)).toBe(1234);
    expect(microsToWon(1_499_999)).toBe(1);
    expect(microsToWon(1_500_000)).toBe(2);
    expect(microsToWon(-1_500_000)).toBe(-2);
    expect(microsToWon(0)).toBe(0);
  });

  it('formats KRW', () => {
    expect(formatKrw(1_234_567_000_000)).toBe('₩1,234,567');
    expect(formatKrw(-5_000_000_000)).toBe('-₩5,000');
  });

  it('keeps large sums exact', () => {
    // ₩9,000,000,000 = 9e15 micros, near MAX_SAFE_INTEGER
    expect(formatKrw(9_000_000_000_000_000)).toBe('₩9,000,000,000');
  });

  it('formats compact axis labels', () => {
    expect(formatKrwCompact(120_000_000_000)).toBe('12만');
    expect(formatKrwCompact(125_000_000_000)).toBe('12.5만');
    expect(formatKrwCompact(150_000_000_000_000)).toBe('1.5억');
    expect(formatKrwCompact(8_000_000_000)).toBe('8,000');
  });

  it('computes percent change', () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(5, 0)).toBeNull();
  });

  it('formats relative time', () => {
    const now = new Date('2026-11-10T03:00:00Z');
    expect(relativeTime(new Date('2026-11-10T02:59:30Z'), now)).toBe('방금');
    expect(relativeTime(new Date('2026-11-10T02:57:00Z'), now)).toBe('3분 전');
    expect(relativeTime(new Date('2026-11-10T01:00:00Z'), now)).toBe('2시간 전');
  });
});
