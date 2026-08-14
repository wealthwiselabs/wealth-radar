import { describe, it, expect } from 'vitest';
import { formatPercent } from '@/lib/chartConfig';

describe('formatPercent', () => {
  it('formats a positive fraction with a leading +', () => {
    expect(formatPercent(0.0523)).toBe('+5.2%');
  });
  it('formats a negative fraction', () => {
    expect(formatPercent(-0.1285)).toBe('-12.9%');
  });
  it('formats zero without a sign forced to negative', () => {
    expect(formatPercent(0)).toBe('0.0%');
  });
  it('honours a digits argument', () => {
    expect(formatPercent(-0.1285, 2)).toBe('-12.85%');
  });
});
