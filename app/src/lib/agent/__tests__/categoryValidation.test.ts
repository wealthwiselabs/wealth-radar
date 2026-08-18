import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { editTransactionMetadataTool, updateMatchingRuleTool } from '@/lib/agent/tools/write';
import { buildSystemPrompt } from '@/lib/agent/systemPrompt';
import { addTransactions, readTransactions } from '@/lib/storage';

const seed = (over: Record<string, unknown> = {}) => ({
  id: '', date: '2026-01-05', description: 'YOGA FLOW SF', amount: -20,
  bank: 'Chase', account: 'Checking', categoryId: 'shopping', subcategoryId: 'general',
  note: '', source: 'a.pdf', createdAt: '', modifiedAt: '', ...over,
} as any);

describe('write tools reject invented category/subcategory ids', () => {
  it('edit_transaction_metadata rejects an unknown category and does NOT change the row', async () => {
    const { db } = makeTmpDb();
    await addTransactions([seed()], db);
    const [tx] = await readTransactions(db);

    const res = await editTransactionMetadataTool.run!(
      { id: tx.id, categoryId: 'personal_care', subcategoryId: 'fitness' }, // invented ids
      { db },
    );
    expect(res.isError).toBe(true);
    expect(res.content.toLowerCase()).toContain('unknown category');
    // row untouched
    const [after] = await readTransactions(db);
    expect(after.categoryId).toBe('shopping');
  });

  it('edit_transaction_metadata rejects an unknown subcategory under a valid category', async () => {
    const { db } = makeTmpDb();
    await addTransactions([seed()], db);
    const [tx] = await readTransactions(db);
    const res = await editTransactionMetadataTool.run!(
      { id: tx.id, categoryId: 'personal-care', subcategoryId: 'fitness' },
      { db },
    );
    expect(res.isError).toBe(true);
    expect(res.content.toLowerCase()).toContain('unknown subcategory');
  });

  it('edit_transaction_metadata accepts the real taxonomy ids', async () => {
    const { db } = makeTmpDb();
    await addTransactions([seed()], db);
    const [tx] = await readTransactions(db);
    const res = await editTransactionMetadataTool.run!(
      { id: tx.id, categoryId: 'personal-care', subcategoryId: 'gym' },
      { db },
    );
    expect(res.isError).toBeFalsy();
    const [after] = await readTransactions(db);
    expect(after.categoryId).toBe('personal-care');
    expect(after.subcategoryId).toBe('gym');
  });

  it('update_matching_rule rejects invented ids', async () => {
    const { db } = makeTmpDb();
    const res = await updateMatchingRuleTool.run!(
      { pattern: 'yoga', categoryId: 'personal_care', subcategoryId: 'fitness' },
      { db },
    );
    expect(res.isError).toBe(true);
    expect(res.content.toLowerCase()).toContain('unknown category');
  });
});

describe('buildSystemPrompt taxonomy injection', () => {
  it('includes the taxonomy ids when provided', () => {
    const out = buildSystemPrompt('', 'housing (Housing): rent (Rent)');
    expect(out).toContain('MUST use these EXACT ids');
    expect(out).toContain('housing (Housing): rent (Rent)');
  });

  it('omits the taxonomy section when not provided', () => {
    expect(buildSystemPrompt('')).not.toContain('MUST use these EXACT ids');
  });
});
