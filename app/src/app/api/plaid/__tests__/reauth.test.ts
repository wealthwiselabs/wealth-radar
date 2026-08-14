import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});
vi.mock('@/lib/plaid/config', async (orig) => {
  const actual = await orig<typeof import('@/lib/plaid/config')>();
  return { ...actual, isPlaidConfigured: () => true };
});
vi.mock('@/lib/plaid/client', () => ({ getPlaidClient: () => ({}) }));
const { syncAllItems, maybeSyncInvestmentsForItem, syncInvestmentTransactions } = vi.hoisted(() => ({
  syncAllItems: vi.fn(async () => ({ items: 1 })),
  maybeSyncInvestmentsForItem: vi.fn(async () => {}),
  syncInvestmentTransactions: vi.fn(async () => ({ transactions: 3, flows: 0 })),
}));
vi.mock('@/lib/plaid/sync', () => ({ syncAllItems }));
vi.mock('@/lib/plaid/syncInvestments', () => ({ maybeSyncInvestmentsForItem }));
vi.mock('@/lib/investments/investmentTransactions', () => ({ syncInvestmentTransactions }));
vi.mock('@/lib/investments/classifySecurities', () => ({ classifyUntaggedSecurities: vi.fn(async () => {}) }));

import { POST } from '../../plaid/reauth/route';
const req = (body: unknown) => new Request('http://t', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as never;
const NOW = '2026-08-08T00:00:00.000Z';

describe('reauth route', () => {
  it('400 on missing itemId', async () => {
    expect((await POST(req({}))).status).toBe(400);
  });
  it('404 on unknown itemId', async () => {
    expect((await POST(req({ itemId: 'nope' }))).status).toBe(404);
  });
  it('runs the item syncs for a known item', async () => {
    db.insert(schema.plaidItems).values({ id: 'it1', plaidItemId: 'P1', institutionName: 'US Bank', owner: 'Alex', accessToken: 'enc', status: 'healthy', createdAt: NOW, modifiedAt: NOW }).run();
    const res = await POST(req({ itemId: 'it1' }));
    expect(res.status).toBe(200);
    expect(syncAllItems).toHaveBeenCalled();
    expect(maybeSyncInvestmentsForItem).toHaveBeenCalledWith('it1', expect.anything(), expect.anything());
  });
});
