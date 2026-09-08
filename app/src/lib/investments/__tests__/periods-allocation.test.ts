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

  // A `to` of today (what every trend caller passes for an open-ended range)
  // lands mid-period. Without opting in, that period is dropped entirely — the
  // current month simply never appears on a chart until it has ended.
  it('omits the period containing `to` by default', () => {
    const ps = enumerateAllocationPeriods('2026-07-01', '2026-09-06', 'monthly');
    expect(ps.map((p) => p.key)).toEqual(['monthly:2026-07', 'monthly:2026-08']);
  });

  it('includes the period containing `to` when asked, clamped to `to`', () => {
    const ps = enumerateAllocationPeriods('2026-07-01', '2026-09-06', 'monthly', true);
    expect(ps.map((p) => p.key)).toEqual([
      'monthly:2026-07', 'monthly:2026-08', 'monthly:2026-09',
    ]);
    const sep = ps[2];
    // Clamped, not extended into the future: the period covers 1st-to-`to`, so
    // its close boundary resolves against a snapshot that can actually exist and
    // its return reads as month-to-date rather than as a whole month.
    expect(sep.startDate).toBe('2026-09-01');
    expect(sep.endDate).toBe('2026-09-06');
  });

  it('never includes a period that has not started, even when opted in', () => {
    const ps = enumerateAllocationPeriods('2026-07-01', '2026-09-06', 'monthly', true);
    expect(ps.map((p) => p.key)).not.toContain('monthly:2026-10');
  });

  it('leaves a period already complete at `to` unclamped', () => {
    const ps = enumerateAllocationPeriods('2026-07-01', '2026-08-31', 'monthly', true);
    expect(ps.map((p) => p.key)).toEqual(['monthly:2026-07', 'monthly:2026-08']);
    expect(ps[1].endDate).toBe('2026-08-31');
  });
});
