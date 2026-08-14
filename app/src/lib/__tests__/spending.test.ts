import { describe, it, expect } from 'vitest';
import { expenseAmount, incomeAmount, sumExpenses, sumIncome, monthlyIncomeTotals } from '@/lib/spending';

/** amount, category, account type ('credit' for cards, 'depository' for bank accounts) */
const t = (amount: number, categoryId: string, accountType = 'depository') =>
  ({ amount, categoryId, accountType });

describe('expense totals', () => {
  it('counts ordinary purchases', () => {
    expect(expenseAmount(t(-25, 'food', 'credit'))).toBe(25);
    expect(sumExpenses([t(-25, 'food'), t(-5, 'transportation')])).toBe(30);
  });

  it('ignores internal transfers on both legs', () => {
    // Paying a card: -2000 leaves checking, +2000 lands on the card.
    expect(expenseAmount(t(-2000, 'transfer'))).toBe(0);
    expect(expenseAmount(t(2000, 'transfer', 'credit'))).toBe(0);
    expect(sumExpenses([t(-25, 'food'), t(-2000, 'transfer')])).toBe(25);
  });

  it('nets a refund against the category it reverses', () => {
    // A Target return on a debit card, classified as shopping.
    expect(expenseAmount(t(18.67, 'shopping'))).toBeCloseTo(-18.67, 2);
    expect(sumExpenses([t(-100, 'shopping'), t(18.67, 'shopping')])).toBeCloseTo(81.33, 2);
  });

  it('treats a positive amount on a credit card as a refund, not income', () => {
    // The bug: these were classified 'income' and inflated the income card.
    const alo = t(140.48, 'income', 'credit');
    const kindle = t(39.50, 'income', 'credit');
    expect(incomeAmount(alo)).toBe(0);
    expect(incomeAmount(kindle)).toBe(0);
    expect(expenseAmount(alo)).toBeCloseTo(-140.48, 2);
    expect(sumIncome([alo, kindle])).toBe(0);
  });

  it('still counts real income on a bank account', () => {
    expect(incomeAmount(t(2502.16, 'income'))).toBeCloseTo(2502.16, 2);
    expect(incomeAmount(t(0.85, 'income'))).toBeCloseTo(0.85, 2);   // savings interest
    expect(expenseAmount(t(2502.16, 'income'))).toBe(0);
  });

  it('does not treat a transfer into a bank account as income', () => {
    expect(incomeAmount(t(900, 'transfer'))).toBe(0);
  });

  it('reproduces the reported July figures', () => {
    // 15,537.80 of real spend, 25,896.04 of transfers, and the refunds that
    // were previously either counted as income or dropped entirely.
    const rows = [
      t(-15537.80, 'food'),
      t(-25896.04, 'transfer'),
      t(140.48, 'income', 'credit'),   // SP ALO refund
      t(39.50, 'income', 'credit'),    // Kindle refund
      t(18.67, 'shopping'),            // Target refund
      t(2502.16, 'income'),            // payroll
    ];
    expect(sumExpenses(rows)).toBeCloseTo(15537.80 - 140.48 - 39.50 - 18.67, 2);
    expect(sumIncome(rows)).toBeCloseTo(2502.16, 2);
  });
});

describe('receipts vs reversals', () => {
  it('treats a tax refund as income, not a negative tax expense', () => {
    // Withholding never appears as an expense, so the refund is new money —
    // netting it would subtract a cost that was never recorded.
    const refund = t(12165, 'taxes');
    expect(incomeAmount(refund)).toBe(12165);
    expect(expenseAmount(refund)).toBe(0);
  });

  it('still treats paying tax as an expense', () => {
    expect(expenseAmount(t(-404, 'taxes'))).toBe(404);
    expect(incomeAmount(t(-404, 'taxes'))).toBe(0);
  });

  it('keeps a card refund a reversal even in a receipt category', () => {
    // Money back on a card is always undoing a charge on that card.
    expect(incomeAmount(t(300, 'taxes', 'credit'))).toBe(0);
    expect(expenseAmount(t(300, 'taxes', 'credit'))).toBe(-300);
  });

  it('leaves merchandise returns netting against their category', () => {
    expect(expenseAmount(t(15.51, 'shopping'))).toBeCloseTo(-15.51, 2);
    expect(incomeAmount(t(15.51, 'shopping'))).toBe(0);
  });
});

describe('monthlyIncomeTotals', () => {
  const row = (date: string, amount: number, categoryId: string, accountType = 'depository') =>
    ({ date, amount, categoryId, accountType });

  it('sums genuine receipts per month, oldest first', () => {
    expect(monthlyIncomeTotals([
      row('2026-02-10', 5000, 'income'),
      row('2026-01-15', 4000, 'income'),
      row('2026-02-20', 1000, 'income'),
    ])).toEqual([
      { month: '2026-01', total: 4000 },
      { month: '2026-02', total: 6000 },
    ]);
  });

  it('excludes transfers and card refunds', () => {
    expect(monthlyIncomeTotals([
      row('2026-01-05', 900, 'transfer'),
      row('2026-01-06', 50, 'groceries', 'credit'),
    ])).toEqual([]);
  });

  it('counts a tax refund as income, matching incomeAmount', () => {
    expect(monthlyIncomeTotals([row('2026-03-01', 12000, 'taxes')]))
      .toEqual([{ month: '2026-03', total: 12000 }]);
  });

  it('omits months whose income nets to zero rather than emitting a 0 row', () => {
    expect(monthlyIncomeTotals([row('2026-01-05', -100, 'income')])).toEqual([]);
  });
});
