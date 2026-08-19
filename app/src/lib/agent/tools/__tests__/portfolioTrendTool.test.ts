import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts } from '@/db/schema';
import { commitSnapshot } from '@/lib/investments/snapshots';
import { getPortfolioTrendTool } from '@/lib/agent/tools/read';

const NOW = '2026-08-03T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

async function seed(db: Db) {
  db.insert(accounts).values({
    id: 'brk', name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    createdAt: NOW, modifiedAt: NOW,
  }).run();
  await commitSnapshot({ accountId: 'brk', asOf: '2026-05-31', source: 'manual', totalValue: 9000,
    holdings: [{ ticker: 'VTI', name: 'V', quantity: null, value: 9000, assetType: 'equity', kind: 'etf' }] }, db);
  await commitSnapshot({ accountId: 'brk', asOf: '2026-06-30', source: 'manual', totalValue: 10000,
    holdings: [{ ticker: 'VTI', name: 'V', quantity: null, value: 10000, assetType: 'equity', kind: 'etf' }] }, db);
  await commitSnapshot({ accountId: 'brk', asOf: '2026-07-31', source: 'manual', totalValue: 11000,
    holdings: [{ ticker: 'VTI', name: 'V', quantity: null, value: 11000, assetType: 'equity', kind: 'etf' }] }, db);
}

describe('get_portfolio_trend tool', () => {
  it('is a read-only tool', () => {
    expect(getPortfolioTrendTool.gate).toBe('none');
    expect(getPortfolioTrendTool.spec.name).toBe('get_portfolio_trend');
  });

  it('returns time-series value points', async () => {
    const { db } = makeTmpDb();
    await seed(db);
    const { content } = await getPortfolioTrendTool.run({ basis: 'monthly' }, { db });
    expect(content).toContain('11,000');
    // more than one period rendered
    expect(content.split('\n').length).toBeGreaterThan(1);
  });

  it('returns a no-data message on an empty db', async () => {
    const { db } = makeTmpDb();
    const { content } = await getPortfolioTrendTool.run({}, { db });
    expect(content).toContain('No investment');
  });
});
