import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { importStatementTool } from '@/lib/agent/tools/write';
import { stageStatement } from '@/lib/agent/staging';
import { readTransactions } from '@/lib/storage';
import type { PendingTransaction } from '@/types';

const seed = (over: Partial<PendingTransaction> = {}): PendingTransaction => ({
  date: '2026-01-05', description: 'X', amount: -10,
  bank: 'Chase', account: 'Checking', categoryId: 'shopping', subcategoryId: 'general',
  note: '', source: 'stmt.pdf', ...over,
});

describe('import_statement tool', () => {
  it('preview reports "no statement staged" for an unknown conversation', async () => {
    const { db } = makeTmpDb();
    const res = await importStatementTool.preview!({}, { db, conversationId: 'unknown-convo' });
    expect(res.diff.summary).toMatch(/No statement is staged/);
  });

  it('preview summarizes the staged statement, and run persists it and clears staging', async () => {
    const { db } = makeTmpDb();
    stageStatement('c1', {
      fileName: 'stmt.pdf',
      transactions: [
        seed({ description: 'COFFEE SHOP', amount: -6.5, date: '2026-01-03' }),
        seed({ description: 'PAYCHECK', amount: 2500, date: '2026-01-10' }),
      ],
    });

    const preview = await importStatementTool.preview!({}, { db, conversationId: 'c1' });
    expect(preview.diff.summary).toMatch(/2 transaction/);
    expect(preview.diff.summary).toMatch(/stmt\.pdf/);

    const runRes = await importStatementTool.run({}, { db, conversationId: 'c1' });
    expect(runRes.isError).toBeFalsy();
    expect(runRes.content).toMatch(/Imported 2 transaction/);
    expect(runRes.content).toMatch(/stmt\.pdf/);

    const rows = await readTransactions(db);
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.description === 'COFFEE SHOP')).toBe(true);
    expect(rows.some((r) => r.description === 'PAYCHECK')).toBe(true);

    // Staging is cleared after a successful import.
    const second = await importStatementTool.run({}, { db, conversationId: 'c1' });
    expect(second.content).toMatch(/Nothing staged to import/);
  });
});
