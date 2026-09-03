import { describe, it, expect } from 'vitest';
import { buildWaterfall } from '@/app/components/netWorth/NetWorthWaterfall';
import type { RegisterRow } from '@/app/net-worth/page';

const row = (over: Partial<RegisterRow>): RegisterRow => ({
  accountId: 'x', name: 'X', side: 'asset', group: 'other', value: 0,
  lastAsOf: '2026-08-01', source: 'manual', reviewIntervalMonths: null,
  securedByAccountId: null, valueLow: null, valueHigh: null, valuationRef: null,
  debtGroup: null, canDelete: false, ...over,
});

describe('buildWaterfall', () => {
  it('steps down from asset groups through debts to the net figure', () => {
    const steps = buildWaterfall([
      row({ name: 'Checking', group: 'cash', value: 85_000 }),
      row({ name: 'Home', group: 'property', value: 1_150_000 }),
      row({ name: 'Mortgage', group: 'debt', debtGroup: 'Mortgage', side: 'liability', value: 620_000 }),
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

  it('lets liabilities exceed assets, producing a negative net worth', () => {
    const steps = buildWaterfall([
      row({ name: 'Checking', group: 'cash', value: 100_000 }),
      row({ name: 'Mortgage', group: 'debt', debtGroup: 'Mortgage', side: 'liability', value: 400_000 }),
    ]);
    expect(steps.at(-1)).toMatchObject({ kind: 'total', runningAfter: -300_000 });
  });
});

describe('buildWaterfall — liabilities are grouped, not listed by account name', () => {
  const debt = (name: string, debtGroup: string, value: number) =>
    row({ accountId: name, name, side: 'liability', group: 'debt', debtGroup, value });

  it('sums several cards into one Credit cards step', () => {
    // Named "Sapphire"/"Everyday" deliberately: bank product names are exactly
    // what must NOT reach the chart.
    const steps = buildWaterfall([
      row({ name: 'Home', group: 'property', value: 1_000_000 }),
      debt('Sapphire', 'Credit cards', 4_000),
      debt('Everyday', 'Credit cards', 3_120),
    ]);
    const labels = steps.map((s) => s.label);
    expect(labels).not.toContain('Sapphire');
    expect(labels).not.toContain('Everyday');
    const cards = steps.find((s) => s.label === 'Credit cards');
    expect(cards?.delta).toBe(-7_120);
  });

  it('orders buckets consistently and omits empty ones', () => {
    const steps = buildWaterfall([
      row({ name: 'Home', group: 'property', value: 1_000_000 }),
      debt('Big Bank', 'Mortgage', 620_000),
      debt('Visa', 'Credit cards', 8_400),
    ]);
    expect(steps.map((s) => s.label)).toEqual(['Property', 'Mortgage', 'Credit cards', 'Net worth']);
  });

  it('still nets correctly once grouped', () => {
    const steps = buildWaterfall([
      row({ name: 'Home', group: 'property', value: 1_000_000 }),
      debt('A', 'Mortgage', 620_000),
      debt('B', 'Credit cards', 5_000),
      debt('C', 'Credit cards', 2_000),
    ]);
    expect(steps.at(-1)).toMatchObject({ kind: 'total', runningAfter: 373_000 });
  });

  it('keeps a liability whose debtGroup is missing rather than dropping it', () => {
    // A null debtGroup must never make real debt vanish from the chart.
    const steps = buildWaterfall([
      row({ name: 'Home', group: 'property', value: 1_000_000 }),
      row({ accountId: 'x', name: 'Mystery', side: 'liability', group: 'debt', debtGroup: null, value: 9_000 }),
    ]);
    expect(steps.find((s) => s.label === 'Other debt')?.delta).toBe(-9_000);
    expect(steps.at(-1)?.runningAfter).toBe(991_000);
  });
});
