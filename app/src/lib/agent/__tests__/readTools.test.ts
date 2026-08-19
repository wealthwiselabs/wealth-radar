import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { addTransactions, readTransactions } from '@/lib/storage';
import { searchTransactionsTool, querySpendingTool, readTools } from '@/lib/agent/tools/read';

async function seed(db: any) {
  await addTransactions(
    [
      {
        id: '', date: '2026-01-05', description: 'AMAZON MARKETPLACE', amount: -42,
        bank: 'Chase', account: 'Checking', categoryId: 'shopping', subcategoryId: 'general',
        note: '', source: 'a.pdf', createdAt: '', modifiedAt: '',
      } as any,
      {
        id: '', date: '2026-01-06', description: 'STARBUCKS', amount: -6,
        bank: 'Chase', account: 'Checking', categoryId: 'food', subcategoryId: 'coffee',
        note: '', source: 'a.pdf', createdAt: '', modifiedAt: '',
      } as any,
      {
        id: '', date: '2026-02-10', description: 'AMAZON WEB SERVICES', amount: -15,
        bank: 'Chase', account: 'Checking', categoryId: 'shopping', subcategoryId: 'general',
        note: '', source: 'a.pdf', createdAt: '', modifiedAt: '',
      } as any,
    ],
    db,
  );
}

describe('searchTransactionsTool', () => {
  it('is a read tool (no gate) that finds by description substring', async () => {
    const { db } = makeTmpDb();
    await seed(db);
    expect(searchTransactionsTool.gate).toBe('none');
    const res = await searchTransactionsTool.run({ query: 'amazon' }, { db });
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('AMAZON');
    expect(res.content).not.toContain('STARBUCKS');
  });

  it('filters by month when provided', async () => {
    const { db } = makeTmpDb();
    await seed(db);
    const res = await searchTransactionsTool.run({ query: 'amazon', month: '2026-01' }, { db });
    expect(res.content).toContain('MARKETPLACE');
    expect(res.content).not.toContain('WEB SERVICES');
  });

  it('reports no matches gracefully', async () => {
    const { db } = makeTmpDb();
    await seed(db);
    const res = await searchTransactionsTool.run({ query: 'nonexistent-merchant' }, { db });
    expect(res.isError).toBeFalsy();
    expect(res.content).toMatch(/no matching/i);
  });

  it('sanity-checks readTransactions returns the seeded rows', async () => {
    const { db } = makeTmpDb();
    await seed(db);
    const rows = await readTransactions(db);
    expect(rows.length).toBe(3);
  });
});

describe('querySpendingTool', () => {
  it('is a read tool (no gate) that reports monthly expense totals', async () => {
    const { db } = makeTmpDb();
    await seed(db);
    expect(querySpendingTool.gate).toBe('none');
    const res = await querySpendingTool.run({}, { db });
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('2026-01');
    expect(res.content).toContain('2026-02');
    expect(res.content).toContain('48.00'); // 42 + 6
    expect(res.content).toContain('15.00');
  });
});

describe('readTools', () => {
  it('exports the read tools (transactions + spending + investments)', () => {
    expect(readTools.map((t) => t.spec.name).sort()).toEqual([
      'get_allocation_breakdown',
      'get_holdings_breakdown',
      'get_portfolio_trend',
      'investment_summary',
      'list_investment_transactions',
      'query_investment_returns',
      'query_reserve',
      'query_spending',
      'search_transactions',
    ]);
    expect(readTools.every((t) => t.gate === 'none')).toBe(true);
  });
});
