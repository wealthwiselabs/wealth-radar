import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, plaidItems } from '@/db/schema';
import { encryptToken } from '@/lib/crypto';
import { syncAllInvestments } from '@/lib/plaid/syncAllInvestments';

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
const NOW = '2026-08-03T00:00:00.000Z';

describe('syncAllInvestments', () => {
  it('runs only for items with investment accounts', async () => {
    const { db } = makeTmpDb();
    for (const [id, cls] of [['bank', 'spending'], ['brk', 'investment']] as const) {
      db.insert(plaidItems).values({ id, plaidItemId: `p-${id}`, institutionName: id, owner: 'Alex', accessToken: encryptToken('x'), status: 'healthy', createdAt: NOW, modifiedAt: NOW }).run();
      db.insert(accounts).values({ id: `a-${id}`, name: id, institution: id, accountClass: cls, type: 'x', origin: 'plaid', plaidItemId: id, plaidAccountId: `pa-${id}`, status: 'active', purpose: 'portfolio', owner: 'Alex', createdAt: NOW, modifiedAt: NOW }).run();
    }
    const spy = vi.fn().mockResolvedValue({ snapshots: 2, skipped: 0 });
    const res = await syncAllInvestments(db, { client: {} as any, syncInvestments: spy });
    expect(res.items).toBe(1);
    expect(res.snapshots).toBe(2);
    expect(spy.mock.calls.map((c) => c[0].id)).toEqual(['brk']);
  });

  it('runs classification after syncing and survives a classifier that throws', async () => {
    const { db } = makeTmpDb();
    db.insert(plaidItems).values({ id: 'brk', plaidItemId: 'p-brk', institutionName: 'brk', owner: 'Alex', accessToken: encryptToken('x'), status: 'healthy', createdAt: NOW, modifiedAt: NOW }).run();
    db.insert(accounts).values({ id: 'a-brk', name: 'brk', institution: 'brk', accountClass: 'investment', type: 'x', origin: 'plaid', plaidItemId: 'brk', plaidAccountId: 'pa-brk', status: 'active', purpose: 'portfolio', owner: 'Alex', createdAt: NOW, modifiedAt: NOW }).run();

    const syncInvestments = vi.fn().mockResolvedValue({ snapshots: 1, skipped: 0 });
    const classifyUntagged = vi.fn().mockRejectedValue(new Error('llm down'));

    const res = await syncAllInvestments(db, {
      client: {} as any,
      syncInvestments: syncInvestments as any,
      classifyUntagged: classifyUntagged as any,
      apiKey: 'test-key',
    });

    expect(classifyUntagged).toHaveBeenCalledTimes(1);
    expect(classifyUntagged).toHaveBeenCalledWith(expect.anything(), { apiKey: 'test-key' });
    expect(res.snapshots).toBe(1); // classification failure did not break the sync
  });

  it('runs investment-transactions sync per item and survives its failure', async () => {
    const { db } = makeTmpDb();
    db.insert(plaidItems).values({ id: 'brk', plaidItemId: 'p-brk', institutionName: 'brk', owner: 'Alex', accessToken: encryptToken('x'), status: 'healthy', createdAt: NOW, modifiedAt: NOW }).run();
    db.insert(accounts).values({ id: 'a-brk', name: 'brk', institution: 'brk', accountClass: 'investment', type: 'x', origin: 'plaid', plaidItemId: 'brk', plaidAccountId: 'pa-brk', status: 'active', purpose: 'portfolio', owner: 'Alex', createdAt: NOW, modifiedAt: NOW }).run();

    const syncInvestments = vi.fn().mockResolvedValue({ snapshots: 1, skipped: 0 });
    const syncTxns = vi.fn().mockRejectedValue(new Error('txns down'));

    const res = await syncAllInvestments(db, {
      client: {} as any,
      syncInvestments: syncInvestments as any,
      syncInvestmentTransactions: syncTxns as any,
      classifyUntagged: (async () => ({ classified: 0, failed: false })) as any,
    });

    expect(syncTxns).toHaveBeenCalledTimes(1);
    expect(res.snapshots).toBe(1); // txns failure did not break the sync
  });
});
