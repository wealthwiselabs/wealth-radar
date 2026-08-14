import { describe, it, expect } from 'vitest';
import { allocationPeriod, enumerateAllocationPeriods } from '@/lib/investments/periods';

describe('allocationPeriod', () => {
  it('quarter uses its own first/last day', () => {
    const q4 = allocationPeriod('quarterly', 2025, 4);
    expect(q4.startDate).toBe('2025-10-01');   // intra-period: quarter's own start
    expect(q4.endDate).toBe('2025-12-31');
    expect(q4.label).toBe('2025 Q4');
    expect(q4.subPeriods).toBeUndefined();
  });
  it('month uses its own first/last day', () => {
    const m = allocationPeriod('monthly', 2025, 2);
    expect(m.startDate).toBe('2025-02-01');
    expect(m.endDate).toBe('2025-02-28');
  });
  it('year spans the calendar year and carries its four quarters', () => {
    const y = allocationPeriod('yearly', 2025, 0);
    expect(y.startDate).toBe('2025-01-01');
    expect(y.endDate).toBe('2025-12-31');
    expect(y.label).toBe('2025');
    expect(y.subPeriods?.map((p) => p.label)).toEqual(['2025 Q1', '2025 Q2', '2025 Q3', '2025 Q4']);
  });
});

describe('enumerateAllocationPeriods', () => {
  it('lists quarters whose end falls in range', () => {
    const ps = enumerateAllocationPeriods('2025-01-01', '2025-09-30', 'quarterly');
    expect(ps.map((p) => p.label)).toEqual(['2025 Q1', '2025 Q2', '2025 Q3']);
  });
  it('lists years whose end falls in range', () => {
    const ps = enumerateAllocationPeriods('2024-06-01', '2026-03-31', 'yearly');
    expect(ps.map((p) => p.label)).toEqual(['2024', '2025']);   // 2026 not complete
  });
});
