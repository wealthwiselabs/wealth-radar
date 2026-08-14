import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';
import {
  readTransactions, addTransactions, updateTransaction, deleteTransaction,
  deduplicateTransactions,
} from '@/lib/storage';
import type { Transaction } from '@/types';

const mk = (over: Partial<Transaction>): Transaction => ({
  id: '', date: '2026-01-15', description: 'STARBUCKS', amount: -4.5,
  owner: '', accountType: 'credit', bank: 'Chase', account: 'Credit Card', accountId: '', accountClass: 'spending',
  categoryId: 'food', subcategoryId: 'coffee',
  note: '', source: 'jan.pdf', createdAt: '', modifiedAt: '', ...over,
});

describe('storage on DB', () => {
  it('addTransactions then readTransactions round-trips bank/account shape', async () => {
    const { db } = makeTmpDb();
    const { added, skipped } = await addTransactions([mk({}), mk({ description: 'PAYCHECK', amount: 1000, categoryId: 'income', subcategoryId: 'salary' })], db);
    expect(added).toHaveLength(2);
    expect(skipped).toBe(0);
    const all = await readTransactions(db);
    expect(all).toHaveLength(2);
    expect(all[0].bank).toBe('Chase');
    expect(all[0].account).toBe('Card'); // canonicalized on ingest (Task 5): "Credit Card" -> "Card"
  });

  it('dedups identical transactions across calls', async () => {
    const { db } = makeTmpDb();
    await addTransactions([mk({})], db);
    const { added, skipped } = await addTransactions([mk({})], db);
    expect(added).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('update and delete work by id', async () => {
    const { db } = makeTmpDb();
    await addTransactions([mk({})], db);
    const [t] = await readTransactions(db);
    const updated = await updateTransaction(t.id, { categoryId: 'coffee-shops', subcategoryId: 'latte' }, db);
    expect(updated?.categoryId).toBe('coffee-shops');
    expect(await deleteTransaction(t.id, db)).toBe(true);
    expect(await readTransactions(db)).toHaveLength(0);
  });

  it('keeps per-file source when one account has transactions from multiple PDFs', async () => {
    // Regression: a folder import posts multiple monthly statements for the same
    // (bank, account) in one addTransactions call. Each row must keep its own source.
    const { db } = makeTmpDb();
    await addTransactions([
      mk({ description: 'JAN COFFEE', date: '2026-01-10', source: 'jan.pdf' }),
      mk({ description: 'FEB COFFEE', date: '2026-02-10', source: 'feb.pdf' }),
    ], db);
    const all = await readTransactions(db);
    expect(all).toHaveLength(2);
    const byDesc = Object.fromEntries(all.map((t) => [t.description, t.source]));
    expect(byDesc['JAN COFFEE']).toBe('jan.pdf');
    expect(byDesc['FEB COFFEE']).toBe('feb.pdf');
  });

  it('fans out across multiple (bank, account) pairs', async () => {
    const { db } = makeTmpDb();
    await addTransactions([
      mk({ bank: 'Chase', account: 'Credit Card', description: 'CHASE BUY' }),
      mk({ bank: 'Amex', account: 'Gold Card', description: 'AMEX BUY' }),
    ], db);
    const all = await readTransactions(db);
    expect(all).toHaveLength(2);
    const byDesc = Object.fromEntries(all.map((t) => [t.description, `${t.bank}|${t.account}`]));
    // canonicalized on ingest (Task 5): "Credit Card" -> "Card", "Gold Card" -> "Gold"
    expect(byDesc['CHASE BUY']).toBe('Chase|Card');
    expect(byDesc['AMEX BUY']).toBe('Amex|Gold');
  });

  it('deduplicateTransactions removes rows sharing an (account, fingerprint)', async () => {
    const { db } = makeTmpDb();
    // Seed one row (creates the account) via the normal path.
    await addTransactions([mk({})], db);
    const seed = db.select().from(schema.transactions).all()[0];
    // Directly insert a second visible row with the SAME account + fingerprint.
    const now = new Date().toISOString();
    db.insert(schema.transactions).values({
      ...seed,
      id: randomUUID(),
      createdAt: now,
      modifiedAt: now,
    }).run();
    expect(await readTransactions(db)).toHaveLength(2);

    const { kept, removed } = await deduplicateTransactions(db);
    expect(removed).toBe(1);
    expect(kept).toBe(1);
    expect(await readTransactions(db)).toHaveLength(1);
  });

  it('uses a row mask when the filename has none', async () => {
    const { db } = makeTmpDb();
    await addTransactions([{
      date: '2026-03-01', description: 'AMEX PURCHASE', amount: -10,
      bank: 'Amex', account: 'Green', source: 'march-amex.pdf',
      categoryId: 'shopping', subcategoryId: 'general', note: '', mask: '3107',
    }], db);
    const acct = db.select().from(schema.accounts).all()[0];
    expect(acct.mask).toBe('3107');
  });

  it('prefers a filename mask over a row mask', async () => {
    const { db } = makeTmpDb();
    await addTransactions([{
      date: '2026-03-01', description: 'CHASE PURCHASE', amount: -10,
      bank: 'Chase', account: 'Southwest', source: '20260320-statements-3104-x.pdf',
      categoryId: 'shopping', subcategoryId: 'general', note: '', mask: '3130',
    }], db);
    const acct = db.select().from(schema.accounts).all()[0];
    expect(acct.mask).toBe('3104');
  });

  it('keeps two cards in one upload as two accounts', async () => {
    const { db } = makeTmpDb();
    await addTransactions([
      {
        date: '2026-03-01', description: 'CARD A', amount: -10,
        bank: 'Amex', account: 'Green', source: 'combined.pdf',
        categoryId: 'shopping', subcategoryId: 'general', note: '', mask: '3107',
      },
      {
        date: '2026-03-02', description: 'CARD B', amount: -20,
        bank: 'Amex', account: 'Green', source: 'combined.pdf',
        categoryId: 'shopping', subcategoryId: 'general', note: '', mask: '3106',
      },
    ], db);
    const masks = db.select().from(schema.accounts).all().map((a) => a.mask).sort();
    expect(masks).toEqual(['3106', '3107']);
  });
});
