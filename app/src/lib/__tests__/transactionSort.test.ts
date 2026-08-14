import { describe, it, expect } from 'vitest';
import { sortTransactions, nextSort, DEFAULT_SORT } from '@/lib/transactionSort';

const rows = [
  { id: 'a', date: '2026-07-01', amount: -50, categoryId: 'food', subcategoryId: 'coffee' },
  { id: 'b', date: '2026-07-03', amount: -900, categoryId: 'housing', subcategoryId: 'rent' },
  { id: 'c', date: '2026-07-02', amount: 2500, categoryId: 'income', subcategoryId: 'salary' },
];
const labels = {
  category: (t: typeof rows[number]) => t.categoryId,
  subcategory: (t: typeof rows[number]) => t.subcategoryId,
};
const order = (s: Parameters<typeof sortTransactions>[1]) =>
  sortTransactions(rows, s, labels).map((r) => r.id);

describe('sortTransactions', () => {
  it('defaults to newest first', () => {
    expect(order(DEFAULT_SORT)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by date ascending', () => {
    expect(order({ key: 'date', dir: 'asc' })).toEqual(['a', 'c', 'b']);
  });

  it('sorts by signed amount, biggest expense first when ascending', () => {
    expect(order({ key: 'amount', dir: 'asc' })).toEqual(['b', 'a', 'c']);
    expect(order({ key: 'amount', dir: 'desc' })).toEqual(['c', 'a', 'b']);
  });

  it('sorts by category and subcategory name', () => {
    expect(order({ key: 'category', dir: 'asc' })).toEqual(['a', 'b', 'c']);
    expect(order({ key: 'subcategory', dir: 'asc' })).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input', () => {
    const before = rows.map((r) => r.id);
    sortTransactions(rows, { key: 'amount', dir: 'asc' }, labels);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it('breaks ties by newest first', () => {
    const tied = [
      { id: 'old', date: '2026-01-01', amount: -10, categoryId: 'food', subcategoryId: 'x' },
      { id: 'new', date: '2026-06-01', amount: -10, categoryId: 'food', subcategoryId: 'x' },
    ];
    const out = sortTransactions(tied, { key: 'category', dir: 'asc' }, {
      category: (t) => t.categoryId, subcategory: (t) => t.subcategoryId,
    });
    expect(out.map((r) => r.id)).toEqual(['new', 'old']);
  });
});

describe('nextSort', () => {
  it('flips direction when the active column is clicked again', () => {
    expect(nextSort({ key: 'date', dir: 'desc' }, 'date')).toEqual({ key: 'date', dir: 'asc' });
  });

  it('uses a sensible first direction for a new column', () => {
    // Amount starts ascending so the biggest expense (most negative) is first.
    expect(nextSort({ key: 'date', dir: 'desc' }, 'amount')).toEqual({ key: 'amount', dir: 'asc' });
    expect(nextSort({ key: 'date', dir: 'desc' }, 'category')).toEqual({ key: 'category', dir: 'asc' });
    expect(nextSort({ key: 'amount', dir: 'asc' }, 'date')).toEqual({ key: 'date', dir: 'desc' });
  });
});
