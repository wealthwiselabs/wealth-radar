import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts } from '@/db/schema';
import { commitSnapshot } from '@/lib/investments/snapshots';
import { getAllocationBreakdownTool } from '@/lib/agent/tools/read';

const NOW = '2026-08-03T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

async function seed(db: Db) {
  db.insert(accounts).values({
    id: 'brk', name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    createdAt: NOW, modifiedAt: NOW,
  }).run();
  await commitSnapshot({
    accountId: 'brk', asOf: '2026-06-30', source: 'manual', totalValue: 10000,
    holdings: [{ ticker: 'VTI', name: 'Vanguard Total', quantity: null, value: 10000, assetType: 'equity', kind: 'etf' }],
  }, db);
  await commitSnapshot({
    accountId: 'brk', asOf: '2026-07-31', source: 'manual', totalValue: 11000,
    holdings: [{ ticker: 'VTI', name: 'Vanguard Total', quantity: null, value: 11000, assetType: 'equity', kind: 'etf' }],
  }, db);
}

describe('get_allocation_breakdown tool', () => {
  it('is a read-only tool', () => {
    expect(getAllocationBreakdownTool.gate).toBe('none');
    expect(getAllocationBreakdownTool.spec.name).toBe('get_allocation_breakdown');
  });

  it('renders the allocation tree with balances', async () => {
    const { db } = makeTmpDb();
    await seed(db);
    const { content } = await getAllocationBreakdownTool.run({}, { db });
    expect(content).toContain('11,000');
    // Equity holdings roll up under the "Stock" bucket in the allocation tree
    // (see bucketPath in @/lib/investments/allocation) — there is no literal
    // "equity" label anywhere in the rendered tree.
    expect(content.toLowerCase()).toContain('stock');
  });

  it('returns a no-data message on an empty db', async () => {
    const { db } = makeTmpDb();
    const { content } = await getAllocationBreakdownTool.run({}, { db });
    expect(content).toContain('No investment');
  });
});
