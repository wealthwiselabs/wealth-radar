import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { makeTmpDb } from '@/test/tmpDb';
import { ingestClassifiedBatch } from '@/lib/ingest';
import { resolveOrCreateAccount } from '@/lib/accounts';
import { transactionFingerprint } from '@/lib/fingerprint';
import { transactions, monthlyAggregates, statementImports } from '@/db/schema';
import { eq } from 'drizzle-orm';

const batch = (over: Partial<Parameters<typeof ingestClassifiedBatch>[0]> = {}) => ({
  account: { institution: 'Chase', name: 'Credit Card' },
  source: 'pdf' as const,
  sourceFile: 'jan.pdf',
  transactions: [
    { date: '2026-01-15', description: 'STARBUCKS', amount: -4.5, categoryId: 'food', subcategoryId: 'coffee' },
    { date: '2026-01-20', description: 'PAYCHECK', amount: 1000, categoryId: 'income', subcategoryId: 'salary' },
  ],
  ...over,
});

describe('ingestClassifiedBatch', () => {
  it('inserts, aggregates, and records a statement import', async () => {
    const { db } = makeTmpDb();
    const res = await ingestClassifiedBatch(batch(), db);
    expect(res.added).toBe(2);
    expect(res.skipped).toBe(0);
    expect(db.select().from(transactions).all()).toHaveLength(2);
    const food = db.select().from(monthlyAggregates).where(eq(monthlyAggregates.categoryId, 'food')).get();
    expect(food?.expenseTotal).toBe(4.5);
    const income = db.select().from(monthlyAggregates).where(eq(monthlyAggregates.categoryId, 'income')).get();
    expect(income?.incomeTotal).toBe(1000);
    const stmt = db.select().from(statementImports).where(eq(statementImports.month, '2026-01')).get();
    expect(stmt?.sourceFile).toBe('jan.pdf');
  });

  it('is idempotent — re-ingesting the same batch skips all', async () => {
    const { db } = makeTmpDb();
    await ingestClassifiedBatch(batch(), db);
    const res2 = await ingestClassifiedBatch(batch(), db);
    expect(res2.added).toBe(0);
    expect(res2.skipped).toBe(2);
    expect(db.select().from(transactions).all()).toHaveLength(2);
    // The statement import for the month is not duplicated on re-ingest.
    expect(db.select().from(statementImports).all()).toHaveLength(1);
  });

  it('records statement coverage even when every txn dedupes against pre-existing rows', async () => {
    const { db } = makeTmpDb();
    const account = await resolveOrCreateAccount({ institution: 'Chase', name: 'Credit Card' }, db);
    // A manually-entered transaction that later matches a PDF statement line.
    const date = '2026-02-10';
    const description = 'RENT';
    const amount = -1500;
    const now = new Date().toISOString();
    db.insert(transactions).values({
      id: randomUUID(), accountId: account.id, date, month: '2026-02',
      description, amount, categoryId: 'housing', subcategoryId: 'rent', note: '',
      source: 'manual', externalId: null,
      fingerprint: transactionFingerprint({ accountId: account.id, date, description, amount }),
      plaidCategory: null, pending: false, sourceFile: null, supersededBy: null,
      createdAt: now, modifiedAt: now,
    }).run();

    const res = await ingestClassifiedBatch(batch({
      source: 'pdf', sourceFile: 'feb.pdf',
      transactions: [{ date, description, amount, categoryId: 'housing', subcategoryId: 'rent' }],
    }), db);

    expect(res.added).toBe(0);
    expect(res.skipped).toBe(1);
    // Zero-activity statement still counts as covered: the month must have a statement_imports row.
    const stmt = db.select().from(statementImports)
      .where(eq(statementImports.month, '2026-02')).get();
    expect(stmt?.accountId).toBe(account.id);
    expect(stmt?.sourceFile).toBe('feb.pdf');
  });

  it('plaid batch records no statement import', async () => {
    const { db } = makeTmpDb();
    const res = await ingestClassifiedBatch(batch({ source: 'plaid', sourceFile: null }), db);
    expect(res.added).toBe(2);
    expect(db.select().from(statementImports).all()).toHaveLength(0);
  });
});
