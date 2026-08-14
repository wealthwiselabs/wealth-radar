import { randomUUID } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';

type Db = ReturnType<typeof getDb>;

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function recomputeMonthlyAggregates(accountId: string, month: string, db: Db = getDb()): void {
  // Remove existing derived rows for this (account, month); keep summary rows.
  db.delete(schema.monthlyAggregates)
    .where(and(
      eq(schema.monthlyAggregates.accountId, accountId),
      eq(schema.monthlyAggregates.month, month),
      eq(schema.monthlyAggregates.derivedFromTxns, true),
    )).run();

  const rows = db.select().from(schema.transactions)
    .where(and(
      eq(schema.transactions.accountId, accountId),
      eq(schema.transactions.month, month),
      isNull(schema.transactions.supersededBy),
    )).all();

  const byCat = new Map<string, { expense: number; income: number; count: number; source: string }>();
  for (const t of rows) {
    const c = byCat.get(t.categoryId) ?? { expense: 0, income: 0, count: 0, source: t.source };
    if (t.amount < 0) c.expense += -t.amount; else c.income += t.amount;
    c.count += 1;
    byCat.set(t.categoryId, c);
  }

  const now = new Date().toISOString();
  for (const [categoryId, c] of byCat) {
    db.insert(schema.monthlyAggregates).values({
      id: randomUUID(), accountId, month, categoryId,
      expenseTotal: c.expense, incomeTotal: c.income, net: c.income - c.expense,
      txnCount: c.count, derivedFromTxns: true,
      // NOTE: source = first-txn-wins; spec §4 allows 'mixed' for multi-source months — deferred to Phase 3 (aggregates are write-only until then).
      source: c.source, updatedAt: now,
    }).run();
  }
}
