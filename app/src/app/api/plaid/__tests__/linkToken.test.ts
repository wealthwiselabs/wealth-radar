import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});
vi.mock('@/lib/crypto', () => ({ decryptToken: (s: string) => 'ACCESS-'+s, encryptToken: (s: string) => s }));
const linkTokenCreate = vi.fn(async (..._args: any[]) => ({ data: { link_token: 'lt-123' } }));
vi.mock('@/lib/plaid/client', () => ({ getPlaidClient: () => ({ linkTokenCreate }) }));
vi.mock('@/lib/plaid/config', async (orig) => {
  const actual = await orig<typeof import('@/lib/plaid/config')>();
  return { ...actual, isPlaidConfigured: () => true, getPlaidCountryCodes: () => ['US'] };
});

import { POST } from '../../plaid/link-token/route';
const req = (body?: unknown) => new Request('http://t', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }) as never;
const NOW = '2026-08-08T00:00:00.000Z';

describe('link-token route', () => {
  it('new-item mode when no itemId: no access_token, products=[transactions]', async () => {
    linkTokenCreate.mockClear();
    await POST(req());
    const arg = linkTokenCreate.mock.calls[0][0];
    expect(arg.access_token).toBeUndefined();
    expect(arg.products).toContain('transactions');
  });
  it('update mode with itemId on an item that has investment accounts: access_token + investments', async () => {
    db.insert(schema.plaidItems).values({ id: 'it1', plaidItemId: 'P1', institutionName: 'US Bank', owner: 'Alex', accessToken: 'enc1', status: 'healthy', createdAt: NOW, modifiedAt: NOW }).run();
    db.insert(schema.accounts).values({ id: 'a1', name: 'Brokerage', institution: 'US Bank', accountClass: 'investment', type: 'investment', origin: 'plaid', status: 'active', purpose: 'portfolio', owner: 'Alex', plaidItemId: 'it1', plaidAccountId: 'pa1', createdAt: NOW, modifiedAt: NOW }).run();
    linkTokenCreate.mockClear();
    const res = await POST(req({ itemId: 'it1' }));
    expect(res.status).toBe(200);
    const arg = linkTokenCreate.mock.calls[0][0];
    expect(arg.access_token).toBe('ACCESS-enc1');
    expect(arg.products).toContain('investments');
  });
  it('update mode on a bank-only item: access_token, no investments', async () => {
    db.insert(schema.plaidItems).values({ id: 'it2', plaidItemId: 'P2', institutionName: 'Chase', owner: 'Alex', accessToken: 'enc2', status: 'healthy', createdAt: NOW, modifiedAt: NOW }).run();
    db.insert(schema.accounts).values({ id: 'a2', name: 'Checking', institution: 'Chase', accountClass: 'spending', type: 'depository', origin: 'plaid', status: 'active', purpose: 'portfolio', owner: 'Alex', plaidItemId: 'it2', plaidAccountId: 'pa2', createdAt: NOW, modifiedAt: NOW }).run();
    linkTokenCreate.mockClear();
    await POST(req({ itemId: 'it2' }));
    const arg = linkTokenCreate.mock.calls[0][0];
    expect(arg.access_token).toBe('ACCESS-enc2');
    expect(arg.products ?? []).not.toContain('investments');
  });
  it('404 on unknown itemId', async () => {
    const res = await POST(req({ itemId: 'nope' }));
    expect(res.status).toBe(404);
  });
});
