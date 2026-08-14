import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, plaidItems } from '@/db/schema';
import { encryptToken } from '@/lib/crypto';
import { maybeSyncInvestmentsForItem } from '@/lib/plaid/syncInvestments';

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
const NOW = '2026-08-03T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function seedItem(db: Db, withInvestment: boolean) {
  db.insert(plaidItems).values({
    id: 'it1', plaidItemId: 'p1', institutionName: 'Fidelity', owner: 'Alex',
    accessToken: encryptToken('x'), status: 'healthy', createdAt: NOW, modifiedAt: NOW,
  }).run();
  db.insert(accounts).values({
    id: 'a1', name: 'X', institution: 'Fidelity',
    accountClass: withInvestment ? 'investment' : 'spending',
    type: 'x', origin: 'plaid', plaidItemId: 'it1', plaidAccountId: 'pa1',
    status: 'active', purpose: 'portfolio', owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('maybeSyncInvestmentsForItem', () => {
  it('syncs when the item owns an investment account', async () => {
    const { db } = makeTmpDb();
    seedItem(db, true);
    const spy = vi.fn().mockResolvedValue({ snapshots: 1, skipped: 0 });
    await maybeSyncInvestmentsForItem('it1', { client: {} as any, syncInvestments: spy }, db);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('does nothing for a spending-only item', async () => {
    const { db } = makeTmpDb();
    seedItem(db, false);
    const spy = vi.fn();
    await maybeSyncInvestmentsForItem('it1', { client: {} as any, syncInvestments: spy }, db);
    expect(spy).not.toHaveBeenCalled();
  });
});
