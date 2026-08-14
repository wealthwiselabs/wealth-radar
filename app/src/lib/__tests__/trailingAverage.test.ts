import { describe, it, expect } from 'vitest';
import { monthlyExpenseTotals, trailingMonthlyAverage } from '@/lib/spending';

describe('monthlyExpenseTotals', () => {
  const t = (date: string, amount: number, categoryId: string, accountType = 'depository') =>
    ({ date, amount, categoryId, accountType });

  it('groups by month and sums the expense contribution of each row', () => {
    expect(monthlyExpenseTotals([
      t('2026-06-03', -25, 'food'),
      t('2026-06-28', -5, 'transportation'),
      t('2026-07-01', -100, 'housing'),
    ])).toEqual([
      { month: '2026-06', total: 30 },
      { month: '2026-07', total: 100 },
    ]);
  });

  it('leaves out transfers and income, which are not spend', () => {
    expect(monthlyExpenseTotals([
      t('2026-06-03', -25, 'food'),
      t('2026-06-04', -2000, 'transfer'),
      t('2026-06-05', 6801, 'income'),
    ])).toEqual([{ month: '2026-06', total: 25 }]);
  });

  it('nets refunds against the month they land in', () => {
    expect(monthlyExpenseTotals([
      t('2026-06-03', -50, 'shopping', 'credit'),
      t('2026-06-20', 20, 'shopping', 'credit'),
    ])).toEqual([{ month: '2026-06', total: 30 }]);
  });

  it('returns months in ascending order regardless of input order', () => {
    expect(monthlyExpenseTotals([
      t('2026-07-01', -1, 'food'),
      t('2026-05-01', -1, 'food'),
      t('2026-06-01', -1, 'food'),
    ]).map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('returns an empty list for no transactions', () => {
    expect(monthlyExpenseTotals([])).toEqual([]);
  });
});

/**
 * Real shape of this user's history: two barely-covered months at the start
 * (only one or two accounts had been imported yet), then eight full months,
 * then a current month one day old. Averaging across everything reads ~18%
 * low, which is exactly what the window is here to avoid.
 */
const SERIES = [
  { month: '2025-10', total: 406 },
  { month: '2025-11', total: 3729 },
  { month: '2025-12', total: 18675 },
  { month: '2026-01', total: 17154 },
  { month: '2026-02', total: 14636 },
  { month: '2026-03', total: 19037 },
  { month: '2026-04', total: 22710 },
  { month: '2026-05', total: 14421 },
  { month: '2026-06', total: 14397 },
  { month: '2026-07', total: 18704 },
  { month: '2026-08', total: 2409 },
];

describe('trailingMonthlyAverage', () => {
  it('averages the six most recent complete months', () => {
    const result = trailingMonthlyAverage(SERIES, '2026-08');
    // Feb–Jul: the partial current month and the two ramp-up months fall out.
    expect(result).toEqual({
      average: 17317.5,
      monthsUsed: 6,
      from: '2026-02',
      to: '2026-07',
    });
  });

  it('excludes the current month even when it is the largest', () => {
    const result = trailingMonthlyAverage(
      [
        { month: '2026-06', total: 100 },
        { month: '2026-07', total: 200 },
        { month: '2026-08', total: 99999 },
      ],
      '2026-08',
    );
    expect(result?.average).toBe(150);
    expect(result?.to).toBe('2026-07');
  });

  it('averages over fewer months when fewer are available, and says how many', () => {
    const result = trailingMonthlyAverage(
      [
        { month: '2026-06', total: 100 },
        { month: '2026-07', total: 300 },
        { month: '2026-08', total: 50 },
      ],
      '2026-08',
    );
    expect(result).toEqual({ average: 200, monthsUsed: 2, from: '2026-06', to: '2026-07' });
  });

  it('returns null when only the current month has data', () => {
    expect(trailingMonthlyAverage([{ month: '2026-08', total: 2409 }], '2026-08')).toBeNull();
  });

  it('returns null for an empty series', () => {
    expect(trailingMonthlyAverage([], '2026-08')).toBeNull();
  });

  it('ignores months dated after the current month', () => {
    // A mis-dated or pre-authorized row must not drag the window forward.
    const result = trailingMonthlyAverage(
      [
        { month: '2026-06', total: 100 },
        { month: '2026-07', total: 200 },
        { month: '2026-08', total: 5 },
        { month: '2027-01', total: 99999 },
      ],
      '2026-08',
    );
    expect(result).toEqual({ average: 150, monthsUsed: 2, from: '2026-06', to: '2026-07' });
  });

  it('honors a custom window size', () => {
    const result = trailingMonthlyAverage(SERIES, '2026-08', 3);
    // May–Jul.
    expect(result?.monthsUsed).toBe(3);
    expect(result?.from).toBe('2026-05');
    expect(result?.average).toBeCloseTo((14421 + 14397 + 18704) / 3, 4);
  });

  it('does not assume the series is already sorted', () => {
    const shuffled = [...SERIES].reverse();
    expect(trailingMonthlyAverage(shuffled, '2026-08')?.average).toBe(17317.5);
  });
});
