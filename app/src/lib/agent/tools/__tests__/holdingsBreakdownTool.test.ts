import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, cashFlows, investmentTransactions } from '@/db/schema';
import { commitSnapshot } from '@/lib/investments/snapshots';
import { getHoldingsBreakdownTool } from '@/lib/agent/tools/read';

const NOW = '2026-08-03T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function seedAccount(db: Db, id: string, over: Record<string, unknown> = {}) {
  db.insert(accounts).values({
    id, name: id, institution: 'Bank', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    createdAt: NOW, modifiedAt: NOW, ...over,
  }).run();
}

async function seed(db: Db) {
  seedAccount(db, 'brk', { name: 'Brokerage', institution: 'Fidelity' });
  await commitSnapshot({
    accountId: 'brk', asOf: '2026-06-30', source: 'manual', totalValue: 10000,
    holdings: [{ ticker: 'VTI', name: 'Vanguard Total', quantity: null, value: 10000, assetType: 'equity', kind: 'etf' }],
  }, db);
  await commitSnapshot({
    accountId: 'brk', asOf: '2026-07-31', source: 'manual', totalValue: 11000,
    holdings: [{ ticker: 'VTI', name: 'Vanguard Total', quantity: null, value: 11000, assetType: 'equity', kind: 'etf' }],
  }, db);
  db.insert(investmentTransactions).values({
    id: 'it1', accountId: 'brk', plaidInvestmentTxnId: 'p1', securityId: null,
    date: '2026-07-20', name: 'Buy VTI', amount: 2500, type: 'buy', createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('get_holdings_breakdown tool', () => {
  it('is a read-only tool', () => {
    expect(getHoldingsBreakdownTool.gate).toBe('none');
    expect(getHoldingsBreakdownTool.spec.name).toBe('get_holdings_breakdown');
  });

  it('reports holdings and the end value for an account', async () => {
    const { db } = makeTmpDb();
    await seed(db);
    const { content } = await getHoldingsBreakdownTool.run({ account: 'all' }, { db });
    expect(content).toContain('Brokerage');
    expect(content).toContain('VTI');
    expect(content).toContain('11,000');
  });

  it('returns a no-data message on an empty db', async () => {
    const { db } = makeTmpDb();
    const { content } = await getHoldingsBreakdownTool.run({}, { db });
    expect(content).toContain('No investment');
  });
});
