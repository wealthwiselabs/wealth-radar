import { describe, it, expect } from 'vitest';
import { buildWaterfall } from '@/app/components/netWorth/NetWorthWaterfall';
import type { RegisterRow } from '@/app/net-worth/page';

const row = (over: Partial<RegisterRow>): RegisterRow => ({
  accountId: 'x', name: 'X', side: 'asset', group: 'other', value: 0,
  lastAsOf: '2026-08-01', source: 'manual', reviewIntervalMonths: null,
  securedByAccountId: null, valueLow: null, valueHigh: null, canDelete: false, ...over,
});

describe('buildWaterfall', () => {
  it('steps down from asset groups through debts to the net figure', () => {
    const steps = buildWaterfall([
      row({ name: 'Checking', group: 'cash', value: 85_000 }),
      row({ name: 'Home', group: 'property', value: 1_150_000 }),
      row({ name: 'Mortgage', group: 'debt', side: 'liability', value: 620_000 }),
    ]);
    expect(steps.map((s) => s.label)).toEqual(['Cash', 'Property', 'Mortgage', 'Net worth']);
    expect(steps[0].runningAfter).toBe(85_000);
    expect(steps[1].runningAfter).toBe(1_235_000);
    expect(steps[2].delta).toBe(-620_000);
    expect(steps.at(-1)).toMatchObject({ kind: 'total', runningAfter: 615_000 });
  });

  it('skips a group with no valued items rather than drawing a zero bar', () => {
    const steps = buildWaterfall([row({ name: 'Checking', group: 'cash', value: 85_000 })]);
    expect(steps.map((s) => s.label)).toEqual(['Cash', 'Net worth']);
  });

  it('ignores unvalued items entirely', () => {
    const steps = buildWaterfall([
      row({ name: 'Checking', group: 'cash', value: 85_000 }),
      row({ name: 'Second car', group: 'vehicles', value: null }),
    ]);
    expect(steps.map((s) => s.label)).toEqual(['Cash', 'Net worth']);
  });
});
