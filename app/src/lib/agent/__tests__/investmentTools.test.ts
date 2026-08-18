import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { commitSnapshot } from '@/lib/investments/snapshots';
import { accounts, cashFlows, investmentTransactions } from '@/db/schema';
import {
  investmentSummaryTool,
  listInvestmentTransactionsTool,
  queryInvestmentReturnsTool,
  queryReserveTool,
} from '@/lib/agent/tools/read';

const NOW = '2026-08-03T00:00:00.000Z';

type Db = ReturnType<typeof makeTmpDb>['db'];

function seedAccount(db: Db, id: string, over: Record<string, unknown> = {}) {
  db.insert(accounts).values({
    id, name: id, institution: 'Bank', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    createdAt: NOW, modifiedAt: NOW, ...over,
  }).run();
}

/**
 * A minimal but realistic fixture: one portfolio account with two snapshots
 * (10000 → 11000, a clean +10% with no flows), a reserve account with a
 * confirmed contribution and a reserve snapshot, and one investment
 * transaction for the activity stream.
 */
async function seedFixture(db: Db) {
  seedAccount(db, 'brk');
  seedAccount(db, 'res', { purpose: 'reserve', name: 'Money Fund', institution: 'Vanguard' });

  await commitSnapshot({
    accountId: 'brk', asOf: '2026-06-30', source: 'manual', totalValue: 10000,
    holdings: [{ ticker: 'VTI', name: 'Vanguard Total', quantity: null, value: 10000, assetType: 'equity', kind: 'etf' }],
  }, db);
  await commitSnapshot({
    accountId: 'brk', asOf: '2026-07-31', source: 'manual', totalValue: 11000,
    holdings: [{ ticker: 'VTI', name: 'Vanguard Total', quantity: null, value: 11000, assetType: 'equity', kind: 'etf' }],
  }, db);
  await commitSnapshot({
    accountId: 'res', asOf: '2026-07-31', source: 'manual', totalValue: 5000,
  }, db);

  db.insert(cashFlows).values({
    id: 'rf1', accountId: 'res', date: '2026-07-15', amount: 5000, kind: 'contribution',
    source: 'manual', confirmed: true, note: 'emergency top up', createdAt: NOW, modifiedAt: NOW,
  }).run();

  db.insert(investmentTransactions).values({
    id: 'it1', accountId: 'brk', plaidInvestmentTxnId: 'p1', securityId: null,
    date: '2026-07-20', name: 'Buy VTI', amount: 2500, type: 'buy',
    createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('investment_summary tool', () => {
  it('reports the seeded portfolio total, allocation, and trailing return', async () => {
    const { db } = makeTmpDb();
    await seedFixture(db);

    const { content } = await investmentSummaryTool.run({}, { db });
    expect(content).toContain('11,000.00');   // latest household value
    expect(content).toContain('Stock');       // top-level allocation bucket
    expect(content).toContain('10.00%');      // clean +10% trailing return
  });

  it('returns a graceful message on an empty db', async () => {
    const { db } = makeTmpDb();
    const { content } = await investmentSummaryTool.run({}, { db });
    expect(content).toBe('No investment data.');
  });
});

describe('query_reserve tool', () => {
  it('reports the reserve balance and lists the seeded reserve flow', async () => {
    const { db } = makeTmpDb();
    await seedFixture(db);

    const { content } = await queryReserveTool.run({}, { db });
    expect(content).toContain('5,000.00');            // balance and/or flow amount
    expect(content).toContain('emergency top up');    // the seeded flow note
    expect(content).toContain('Vanguard · Money Fund');
  });

  it('returns a graceful message on an empty db', async () => {
    const { db } = makeTmpDb();
    const { content } = await queryReserveTool.run({}, { db });
    expect(content).toBe('No investment data.');
  });
});

describe('query_investment_returns tool', () => {
  it('computes the seeded +10% portfolio return', async () => {
    const { db } = makeTmpDb();
    await seedFixture(db);

    const { content } = await queryInvestmentReturnsTool.run({}, { db });
    expect(content).toContain('10.00%');
  });

  it('returns a graceful message on an empty db', async () => {
    const { db } = makeTmpDb();
    const { content } = await queryInvestmentReturnsTool.run({}, { db });
    expect(content).toBe('No investment data.');
  });
});

describe('list_investment_transactions tool', () => {
  it('lists the seeded investment transaction', async () => {
    const { db } = makeTmpDb();
    await seedFixture(db);

    const { content } = await listInvestmentTransactionsTool.run({}, { db });
    expect(content).toContain('buy');
    expect(content).toContain('Buy VTI');
    expect(content).toContain('2,500.00');
  });

  it('filters by type', async () => {
    const { db } = makeTmpDb();
    await seedFixture(db);

    const { content } = await listInvestmentTransactionsTool.run({ type: 'sell' }, { db });
    expect(content).toBe('No matching investment transactions.');
  });

  it('returns a graceful message on an empty db', async () => {
    const { db } = makeTmpDb();
    const { content } = await listInvestmentTransactionsTool.run({}, { db });
    expect(content).toBe('No investment data.');
  });
});
