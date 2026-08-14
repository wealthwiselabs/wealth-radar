// src/lib/investments/__tests__/periods.test.ts
import { describe, it, expect } from 'vitest';
import {
  generatePeriods, resolveBoundary, rangeToDates,
  MONTHLY_TOLERANCE_DAYS, QUARTERLY_TOLERANCE_DAYS,
} from '@/lib/investments/periods';
import type { SnapshotWithHoldings } from '@/lib/investments/snapshots';

function snap(asOf: string): SnapshotWithHoldings {
  return { id: asOf, accountId: 'a', asOf, month: asOf.slice(0, 7), source: 'paste',
    totalValue: 0, holdingsComplete: false, holdings: [] };
}

describe('generatePeriods', () => {
  it('emits monthly periods with month-end boundaries and a shared prior boundary', () => {
    const ps = generatePeriods('2026-05-01', '2026-07-31', 'monthly');
    expect(ps.map((p) => p.label)).toEqual(["May '26", "Jun '26", "Jul '26"]);
    const jun = ps[1];
    expect(jun.openDate).toBe('2026-05-31');   // previous month-end
    expect(jun.closeDate).toBe('2026-06-30');
  });

  it('emits quarterly periods carrying three constituent months', () => {
    const ps = generatePeriods('2025-01-01', '2025-06-30', 'quarterly');
    expect(ps.map((p) => p.label)).toEqual(['2025 Q1', '2025 Q2']);
    const q1 = ps[0];
    expect(q1.openDate).toBe('2024-12-31');
    expect(q1.closeDate).toBe('2025-03-31');
    expect(q1.months?.map((m) => m.closeDate)).toEqual(['2025-01-31', '2025-02-28', '2025-03-31']);
  });
});

describe('resolveBoundary', () => {
  const snaps = [snap('2025-01-01'), snap('2025-03-31'), snap('2026-06-30')];

  it('picks a snapshot inside the tolerance window', () => {
    // 2025-01-01 is 1 day from the 2024-12-31 quarter boundary.
    expect(resolveBoundary(snaps, '2024-12-31', QUARTERLY_TOLERANCE_DAYS)?.asOf).toBe('2025-01-01');
  });

  it('returns null when the nearest snapshot is outside tolerance (no carry-forward)', () => {
    // Nearest to a 2025-08-31 month boundary is 2026-06-30 — far outside 16 days.
    expect(resolveBoundary(snaps, '2025-08-31', MONTHLY_TOLERANCE_DAYS)).toBeNull();
  });

  it('prefers the on/before snapshot on a tie', () => {
    const s = [snap('2026-06-29'), snap('2026-07-01')];   // both 1 day from 2026-06-30
    expect(resolveBoundary(s, '2026-06-30', MONTHLY_TOLERANCE_DAYS)?.asOf).toBe('2026-06-29');
  });
});

describe('rangeToDates', () => {
  it('gives a trailing window for a numeric count', () => {
    const { from, to } = rangeToDates('quarterly', 8, '2024-01-01', '2026-08-04');
    expect(to).toBe('2026-08-04');
    expect(from).toBe('2024-08-04');   // 8 quarters = 24 months back
  });
  it('spans from the earliest snapshot when count is "all"', () => {
    const { from } = rangeToDates('monthly', 'all', '2025-01-01', '2026-08-04');
    expect(from).toBe('2025-01-01');
  });
  it('falls back to the trailing default when there is no earliest snapshot', () => {
    const { from } = rangeToDates('monthly', 'all', null, '2026-08-04');
    expect(from).toBe('2025-08-04');   // 12 months back
  });
});
