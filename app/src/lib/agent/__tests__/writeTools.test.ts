import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import {
  editTransactionMetadataTool,
  updateMatchingRuleTool,
  mergeAccountsTool,
  reconcileTransactionsTool,
  writeTools,
  writeToolsByName,
} from '@/lib/agent/tools/write';
import { addTransactions, readTransactions, findTransactionById } from '@/lib/storage';

const seed = (over: Record<string, unknown> = {}) => ({
  id: '', date: '2026-01-05', description: 'X', amount: -10,
  bank: 'Chase', account: 'Checking', categoryId: 'shopping', subcategoryId: 'general',
  note: '', source: 'a.pdf', createdAt: '', modifiedAt: '', ...over,
} as any);

describe('write tools', () => {
  it('exposes the four tools by name', () => {
    expect(writeTools).toHaveLength(4);
    expect(writeToolsByName.get('edit_transaction_metadata')).toBe(editTransactionMetadataTool);
    expect(writeToolsByName.get('update_matching_rule')).toBe(updateMatchingRuleTool);
    expect(writeToolsByName.get('reconcile_transactions')).toBe(reconcileTransactionsTool);
    expect(writeToolsByName.get('merge_accounts')).toBe(mergeAccountsTool);
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
});
