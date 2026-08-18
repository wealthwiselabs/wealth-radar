import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';
import {
  editTransactionMetadataTool,
  updateMatchingRuleTool,
  mergeAccountsTool,
  reconcileTransactionsTool,
  writeTools,
  writeToolsByName,
} from '@/lib/agent/tools/write';
import { addTransactions, readTransactions, findTransactionById } from '@/lib/storage';
import { ingestClassifiedBatch } from '@/lib/ingest';

const seed = (over: Record<string, unknown> = {}) => ({
  id: '', date: '2026-01-05', description: 'X', amount: -10,
  bank: 'Chase', account: 'Checking', categoryId: 'shopping', subcategoryId: 'general',
  note: '', source: 'a.pdf', createdAt: '', modifiedAt: '', ...over,
} as any);

describe('write tools', () => {
  it('exposes the five tools by name', () => {
    expect(writeTools).toHaveLength(5);
    expect(writeToolsByName.get('edit_transaction_metadata')).toBe(editTransactionMetadataTool);
    expect(writeToolsByName.get('update_matching_rule')).toBe(updateMatchingRuleTool);
    expect(writeToolsByName.get('reconcile_transactions')).toBe(reconcileTransactionsTool);
    expect(writeToolsByName.get('merge_accounts')).toBe(mergeAccountsTool);
    expect(writeToolsByName.get('import_statement')).toBeDefined();
  });

  it('edit_transaction_metadata is apply-undo gated and recategorizes one row', async () => {
    const { db } = makeTmpDb();
    await addTransactions([seed()], db);
    const [tx] = await readTransactions(db);

    expect(editTransactionMetadataTool.gate).toBe('apply-undo');
    const res = await editTransactionMetadataTool.run(
      { id: tx.id, categoryId: 'food', subcategoryId: 'coffee' },
      { db },
    );
    expect(res.isError).toBeFalsy();

    const after = await findTransactionById(tx.id, db);
    expect(after?.categoryId).toBe('food');
    expect(after?.subcategoryId).toBe('coffee');
  });

  it('edit_transaction_metadata reports a missing id as an error', async () => {
    const { db } = makeTmpDb();
    const res = await editTransactionMetadataTool.run({ id: 'nope', note: 'x' }, { db });
    expect(res.isError).toBe(true);
  });

  it('update_matching_rule is confirm-gated, recategorizes matching rows, and reports the count', async () => {
    const { db } = makeTmpDb();
    await addTransactions([
      seed({ description: 'BLUE BOTTLE COFFEE #1', date: '2026-01-10' }),
      seed({ description: 'BLUE BOTTLE COFFEE #2', date: '2026-01-11' }),
    ], db);

    expect(updateMatchingRuleTool.gate).toBe('confirm');
    expect(typeof updateMatchingRuleTool.preview).toBe('function');

    const res = await updateMatchingRuleTool.run(
      { pattern: 'BLUE BOTTLE', categoryId: 'food', subcategoryId: 'coffee' },
      { db },
    );
    expect(res.isError).toBeFalsy();
    expect(res.content).toMatch(/2 transaction/);

    const rows = await readTransactions(db);
    expect(rows.every((r) => r.categoryId === 'food' && r.subcategoryId === 'coffee')).toBe(true);
  });

  it('merge_accounts is confirm-gated and has a preview', () => {
    expect(mergeAccountsTool.gate).toBe('confirm');
    expect(typeof mergeAccountsTool.preview).toBe('function');
  });

  it('reconcile_transactions is confirm-gated and returns kept/removed counts', async () => {
    const { db } = makeTmpDb();
    await addTransactions([seed()], db);
    expect(reconcileTransactionsTool.gate).toBe('confirm');
    const res = await reconcileTransactionsTool.run({}, { db });
    expect(res.isError).toBeFalsy();
    expect(res.content).toMatch(/kept/);
  });

  it('merge_accounts reassigns the source account\'s transactions onto the target and removes the source', async () => {
    const { db } = makeTmpDb();
    // Two distinct (bank, account) pairs → two accounts created.
    await addTransactions([
      seed({ bank: 'Chase', account: 'Checking', description: 'PAYCHECK', amount: 2500, date: '2026-01-03' }),
      seed({ bank: 'Amex', account: 'Gold Card', description: 'COFFEE', amount: -6, date: '2026-01-04' }),
    ], db);

    const before = await readTransactions(db);
    const targetId = before.find((t) => t.bank === 'Chase')!.accountId;
    const sourceId = before.find((t) => t.bank === 'Amex')!.accountId;
    expect(targetId).not.toBe(sourceId);
    const sourceTxId = before.find((t) => t.bank === 'Amex')!.id;

    const res = await mergeAccountsTool.run({ targetId, sourceIds: [sourceId] }, { db });
    expect(res.isError).toBeFalsy();
    expect(res.content).toMatch(/Merged/i);

    // mergeAccounts reassigns the source's rows to the target (fingerprint-deduping
    // against the target's pre-merge rows) and then deletes the source account row.
    const movedTx = await findTransactionById(sourceTxId, db);
    expect(movedTx?.accountId).toBe(targetId);

    const after = await readTransactions(db);
    expect(after.every((t) => t.accountId === targetId)).toBe(true);

    const sourceStillExists = db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, sourceId))
      .get();
    expect(sourceStillExists).toBeUndefined();
  });

  it('reconcile_transactions collapses a genuine cross-source duplicate (real dedup, not a no-op)', async () => {
    const { db } = makeTmpDb();
    const ACCT = { institution: 'Chase', name: 'Freedom Unlimited', mask: '3128' };
    // Same account, exact amount, dates within the cross-source window: the PDF
    // carries the raw descriptor, Plaid the cleaned merchant name. deduplicate's
    // pass 2 supersedes the Plaid row.
    await ingestClassifiedBatch({
      account: ACCT, source: 'pdf', sourceFile: 'jan.pdf',
      transactions: [{ date: '2026-01-04', description: 'Kindle Svcs*BV5J31CH1 888-802-3080 WA', amount: -7.99, categoryId: 'education', subcategoryId: 'books' }],
    }, db);
    await ingestClassifiedBatch({
      account: ACCT, source: 'plaid', sourceFile: null,
      transactions: [{ date: '2026-01-05', description: 'Kindle Svcs', amount: -7.99, categoryId: 'education', subcategoryId: 'books', externalId: 'plaid-1' }],
    }, db);
    expect(await readTransactions(db)).toHaveLength(2);

    const res = await reconcileTransactionsTool.run({}, { db });
    expect(res.isError).toBeFalsy();
    const removed = Number(res.content.match(/removed (\d+)/)?.[1]);
    expect(removed).toBeGreaterThan(0);

    // The Plaid row was superseded (hidden), not the informative PDF row.
    const visible = await readTransactions(db);
    expect(visible).toHaveLength(1);
    expect(visible[0].description).toBe('Kindle Svcs*BV5J31CH1 888-802-3080 WA');

    const plaidRow = db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.externalId, 'plaid-1'))
      .get();
    expect(plaidRow?.supersededBy).not.toBeNull();
  });
});
