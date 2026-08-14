import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { recomputeMonthlyAggregates, monthOf } from '@/lib/aggregates';
import { accounts, transactions, monthlyAggregates } from '@/db/schema';
import { eq } from 'drizzle-orm';

function seedAccount(db: ReturnType<typeof makeTmpDb>['db']) {
  const now = '2026-07-11T00:00:00.000Z';
  db.insert(accounts).values({
    id: 'a1', name: 'Credit Card', institution: 'Chase', accountClass: 'spending',
    type: 'credit', origin: 'manual', status: 'active', createdAt: now, modifiedAt: now,
  }).run();
}

function tx(over: Partial<typeof transactions.$inferInsert>): typeof transactions.$inferInsert {
  const now = '2026-07-11T00:00:00.000Z';
  return {
    id: over.id ?? crypto.randomUUID(), accountId: 'a1', date: '2026-01-15', month: '2026-01',
    description: 'x', amount: -10, categoryId: 'food', subcategoryId: 'restaurant', note: '',
    source: 'pdf', fingerprint: over.fingerprint ?? crypto.randomUUID(), pending: false,
    createdAt: now, modifiedAt: now, ...over,
  };
}

describe('recomputeMonthlyAggregates', () => {
  it('monthOf extracts YYYY-MM', () => {
    expect(monthOf('2026-01-15')).toBe('2026-01');
  });

  it('sums expenses/income per category and ignores superseded rows', () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    db.insert(transactions).values(tx({ id: 't1', amount: -10, categoryId: 'food' })).run();
    db.insert(transactions).values(tx({ id: 't2', amount: -5, categoryId: 'food' })).run();
    db.insert(transactions).values(tx({ id: 't3', amount: 100, categoryId: 'income' })).run();
    db.insert(transactions).values(tx({ id: 't4', amount: -99, categoryId: 'food', supersededBy: 't1' })).run();

    recomputeMonthlyAggregates('a1', '2026-01', db);

    const food = db.select().from(monthlyAggregates).where(eq(monthlyAggregates.categoryId, 'food')).get();
    expect(food?.expenseTotal).toBe(15);       // -99 superseded row ignored
    expect(food?.txnCount).toBe(2);
    const income = db.select().from(monthlyAggregates).where(eq(monthlyAggregates.categoryId, 'income')).get();
    expect(income?.incomeTotal).toBe(100);
  });

  it('is idempotent and drops categories that no longer have txns', () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    db.insert(transactions).values(tx({ id: 't1', categoryId: 'food' })).run();
    recomputeMonthlyAggregates('a1', '2026-01', db);
    db.delete(transactions).where(eq(transactions.id, 't1')).run();
    recomputeMonthlyAggregates('a1', '2026-01', db);
    expect(db.select().from(monthlyAggregates).all()).toHaveLength(0);
  });

  it('does not touch summary-only (derivedFromTxns=false) rows', () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    db.insert(monthlyAggregates).values({
      id: 's1', accountId: 'a1', month: '2025-05', categoryId: null,
      expenseTotal: 500, incomeTotal: 0, net: -500, txnCount: 0,
      derivedFromTxns: false, source: 'manual', updatedAt: '2026-07-11T00:00:00.000Z',
    }).run();
    recomputeMonthlyAggregates('a1', '2025-05', db);
    const summary = db.select().from(monthlyAggregates).where(eq(monthlyAggregates.id, 's1')).get();
    expect(summary?.expenseTotal).toBe(500);
  });
});
