// app/src/lib/__tests__/removeItem.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';
import { removeItem } from '@/lib/accountRemoval';

vi.mock('@/lib/crypto', () => ({ decryptToken: (s: string) => s, encryptToken: (s: string) => s }));
const NOW = '2026-08-08T00:00:00.000Z';

describe('removeItem', () => {
  it('calls itemRemove, deletes the item accounts and the item row', async () => {
    const { db } = makeTmpDb();
    db.insert(schema.plaidItems).values({ id: 'it1', plaidItemId: 'P1', institutionName: 'US Bank', owner: 'Alex', accessToken: 'enc', status: 'healthy', createdAt: NOW, modifiedAt: NOW }).run();
    db.insert(schema.accounts).values({ id: 'a1', name: 'Brokerage', institution: 'US Bank', accountClass: 'investment', type: 'investment', origin: 'plaid', status: 'active', purpose: 'portfolio', owner: 'Alex', plaidItemId: 'it1', plaidAccountId: 'pa1', createdAt: NOW, modifiedAt: NOW }).run();
    const itemRemove = vi.fn(async () => ({}));
    const res = await removeItem('it1', { client: { itemRemove } }, db);
    expect(itemRemove).toHaveBeenCalledWith({ access_token: 'enc' });
    expect(res).toMatchObject({ removed: true, accounts: 1 });
    expect(db.select().from(schema.accounts).all().length).toBe(0);
    expect(db.select().from(schema.plaidItems).all().length).toBe(0);
  });
  it('still deletes locally when itemRemove throws (best-effort)', async () => {
    const { db } = makeTmpDb();
    db.insert(schema.plaidItems).values({ id: 'it1', plaidItemId: 'P1', institutionName: 'US Bank', owner: 'Alex', accessToken: 'enc', status: 'healthy', createdAt: NOW, modifiedAt: NOW }).run();
    const itemRemove = vi.fn(async () => { throw new Error('plaid down'); });
    const res = await removeItem('it1', { client: { itemRemove } }, db);
    expect(res.removed).toBe(true);
    expect(db.select().from(schema.plaidItems).all().length).toBe(0);
  });
  it('returns removed:false for an unknown item', async () => {
    const { db } = makeTmpDb();
    const res = await removeItem('nope', { client: { itemRemove: vi.fn() } }, db);
    expect(res.removed).toBe(false);
  });
});
