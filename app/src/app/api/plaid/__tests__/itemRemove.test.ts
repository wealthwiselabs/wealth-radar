import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});
vi.mock('@/lib/backup', () => ({ snapshotDb: () => null }));
vi.mock('@/lib/crypto', () => ({ decryptToken: (s: string) => s, encryptToken: (s: string) => s }));
vi.mock('@/lib/plaid/config', async (orig) => {
  const actual = await orig<typeof import('@/lib/plaid/config')>();
  return { ...actual, isPlaidConfigured: () => true };
});
const itemRemove = vi.fn(async () => ({}));
vi.mock('@/lib/plaid/client', () => ({ getPlaidClient: () => ({ itemRemove }) }));

import { POST } from '../../plaid/item/remove/route';
const NOW = '2026-08-08T00:00:00.000Z';
const req = (body: unknown) => new Request('http://t', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as never;

describe('item remove route', () => {
  it('400 on missing itemId', async () => { expect((await POST(req({}))).status).toBe(400); });
  it('404 on unknown itemId', async () => { expect((await POST(req({ itemId: 'nope' }))).status).toBe(404); });
  it('removes the connection', async () => {
    db.insert(schema.plaidItems).values({ id: 'it1', plaidItemId: 'P1', institutionName: 'US Bank', owner: 'Alex', accessToken: 'enc', status: 'healthy', createdAt: NOW, modifiedAt: NOW }).run();
    const res = await POST(req({ itemId: 'it1' }));
    expect(res.status).toBe(200);
    expect(db.select().from(schema.plaidItems).all().length).toBe(0);
  });
});
