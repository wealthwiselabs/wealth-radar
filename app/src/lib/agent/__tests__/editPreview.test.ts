import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { editTransactionMetadataTool } from '@/lib/agent/tools/write';
import { addTransactions, readTransactions } from '@/lib/storage';

const seed = (over: Record<string, unknown> = {}) => ({
  id: '', date: '2026-01-05', description: 'BLUE BOTTLE COFFEE #1', amount: -6,
  bank: 'Chase', account: 'Checking', categoryId: 'shopping', subcategoryId: 'general',
  note: '', source: 'a.pdf', createdAt: '', modifiedAt: '', ...over,
} as any);

describe('edit_transaction_metadata preview', () => {
  it('summarizes the recategorization with the transaction description and resolved taxonomy names', async () => {
    const { db } = makeTmpDb();
    await addTransactions([seed()], db);
    const [tx] = await readTransactions(db);

    const preview = await editTransactionMetadataTool.preview!(
      { id: tx.id, categoryId: 'food', subcategoryId: 'coffee' },
      { db },
    );

    expect(preview.title).toBe('Recategorize transaction?');
    expect(preview.confirmLabel).toBe('Apply');
    expect(preview.diff.summary).toContain(tx.description);
    expect(preview.diff.summary).toContain('Food');
    expect(preview.diff.summary).toContain('Coffee');
  });

  it('reports a missing transaction id as not found', async () => {
    const { db } = makeTmpDb();
    const preview = await editTransactionMetadataTool.preview!(
      { id: 'nope', categoryId: 'food', subcategoryId: 'coffee' },
      { db },
    );
    expect(preview.diff.summary).toContain('not found');
  });
});
