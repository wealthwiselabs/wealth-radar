import { describe, it, expect } from 'vitest';
import { daysBetween, dietzWeight, modifiedDietz, chainReturns } from '@/lib/investments/returns';

function ok(r: ReturnType<typeof modifiedDietz>): number {
  if (r.kind !== 'ok') throw new Error(`expected ok, got missing: ${r.reason}`);
  return r.value;
}

describe('daysBetween', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });
  it('spans month and year boundaries', () => {
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2025-01-01', '2025-03-31')).toBe(89);
  });
});

describe('dietzWeight', () => {
  it('weights a flow at the start of the period as fully present', () => {
    expect(dietzWeight('2026-01-01', '2026-01-01', '2026-01-31')).toBe(1);
  });
  it('weights a flow at the end of the period as absent', () => {
    expect(dietzWeight('2026-01-31', '2026-01-01', '2026-01-31')).toBe(0);
  });
  it('weights a mid-period flow proportionally', () => {
    expect(dietzWeight('2026-01-16', '2026-01-01', '2026-01-31')).toBeCloseTo(0.5, 10);
  });
});

describe('modifiedDietz', () => {
  it('is simple growth when there are no flows', () => {
    expect(ok(modifiedDietz(1000, 1100, [], '2026-01-01', '2026-01-31'))).toBeCloseTo(0.1, 10);
  });

  it('excludes contributed cash from the gain and half-weights a mid-period flow', () => {
    // gain = 1200 - 1000 - 100 = 100; base = 1000 + 100*0.5 = 1050
    const r = ok(modifiedDietz(1000, 1200, [{ date: '2026-01-16', amount: 100 }], '2026-01-01', '2026-01-31'));
    expect(r).toBeCloseTo(100 / 1050, 10);
  });

  it('reproduces the start-weighted formula when a flow lands on the period start', () => {
    // With weight 1 the denominator is V0 + F, which is exactly the sheet's formula.
    const r = ok(modifiedDietz(1000, 1200, [{ date: '2026-01-01', amount: 100 }], '2026-01-01', '2026-01-31'));
    expect(r).toBeCloseTo(100 / 1100, 10);
  });

  it('handles withdrawals', () => {
    // gain = 900 - 1000 - (-200) = 100; base = 1000 - 200*0.5 = 900
    const r = ok(modifiedDietz(1000, 900, [{ date: '2026-01-16', amount: -200 }], '2026-01-01', '2026-01-31'));
    expect(r).toBeCloseTo(100 / 900, 10);
  });

  it('sums several flows', () => {
    const r = ok(modifiedDietz(1000, 1300, [
      { date: '2026-01-01', amount: 100 },
      { date: '2026-01-31', amount: 100 },
    ], '2026-01-01', '2026-01-31'));
    // gain = 1300 - 1000 - 200 = 100; base = 1000 + 100*1 + 100*0 = 1100
    expect(r).toBeCloseTo(100 / 1100, 10);
  });

  it('ignores flows outside the period', () => {
    const r = ok(modifiedDietz(1000, 1100, [{ date: '2025-12-01', amount: 500 }], '2026-01-01', '2026-01-31'));
    expect(r).toBeCloseTo(0.1, 10);
  });

  it('reports missing rather than dividing by zero', () => {
    expect(modifiedDietz(0, 100, [], '2026-01-01', '2026-01-31').kind).toBe('missing');
    const sameDay = modifiedDietz(1000, 1000, [], '2026-01-01', '2026-01-01');
    expect(sameDay.kind).toBe('missing');
  });

  it('matches the reference sheet on 2025 Q1 when contributions are start-weighted', () => {
    const r = ok(modifiedDietz(
      1675448.11, 1480273.34,
      [{ date: '2025-01-01', amount: 23100.09 }],
      '2025-01-01', '2025-03-31',
    ));
    expect(r).toBeCloseTo(-0.12851, 5);
  });

  it('diverges from the sheet, more negative, when the same flow is day-weighted', () => {
    const r = ok(modifiedDietz(
      1675448.11, 1480273.34,
      [{ date: '2025-02-14', amount: 23100.09 }],
      '2025-01-01', '2025-03-31',
    ));
    expect(r).toBeLessThan(-0.12851);
    expect(r).toBeGreaterThan(-0.131);
  });
});

describe('chainReturns', () => {
  it('compounds monthly returns into a quarter', () => {
    const r = chainReturns([
      { kind: 'ok', value: 0.1 },
      { kind: 'ok', value: 0.1 },
      { kind: 'ok', value: 0.1 },
    ]);
    expect(ok(r)).toBeCloseTo(1.1 ** 3 - 1, 10);
  });

  it('cancels a gain against an equal-and-opposite loss correctly', () => {
    const r = chainReturns([{ kind: 'ok', value: 0.5 }, { kind: 'ok', value: -0.5 }]);
    expect(ok(r)).toBeCloseTo(-0.25, 10);
  });

  it('propagates missing rather than silently skipping a period', () => {
    const r = chainReturns([{ kind: 'ok', value: 0.1 }, { kind: 'missing', reason: 'no snapshot' }]);
    expect(r.kind).toBe('missing');
  });

  it('reports missing for an empty list', () => {
    expect(chainReturns([]).kind).toBe('missing');
  });
});
