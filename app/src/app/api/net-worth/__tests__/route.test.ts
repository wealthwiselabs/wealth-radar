import { describe, it, expect, afterEach } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { accounts } from '@/db/schema';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { GET } from '../route';
import { DELETE, PATCH } from '../accounts/[id]/route';
import { createNetWorthAccount, closeNetWorthAccount } from '@/lib/netWorth/write';

afterEach(() => { delete process.env.RENTCAST_API_KEY; });

const req = (url = 'http://t/api/net-worth') => new Request(url) as never;
const patchReq = (body: unknown) => new Request('http://t/api/net-worth/accounts/x', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}) as never;

describe('GET /api/net-worth', () => {
  it('returns totals and one register row per item', async () => {
    const house = await createNetWorthAccount(
      { catalogKey: 'primary_residence', name: 'Home', value: 1_150_000, asOf: '2026-08-01' }, db);
    await createNetWorthAccount(
      { catalogKey: 'mortgage', name: 'Mortgage', value: 620_000, asOf: '2026-08-01', securedByAccountId: house }, db);

    const body = await (await GET(req())).json();
    expect(body.totals.net).toBe(530_000);
    expect(body.rows).toHaveLength(2);
    const mortgage = body.rows.find((r: { name: string }) => r.name === 'Mortgage');
    expect(mortgage.side).toBe('liability');
    expect(mortgage.securedByAccountId).toBe(house);
    expect(mortgage.canDelete).toBe(false);
  });

  it('reports providerConfigured false when RENTCAST_API_KEY is unset', async () => {
    delete process.env.RENTCAST_API_KEY;
    const body = await (await GET(req())).json();
    expect(body.providerConfigured).toBe(false);
  });

  it('reports providerConfigured true when RENTCAST_API_KEY is set', async () => {
    process.env.RENTCAST_API_KEY = 'k';
    const body = await (await GET(req())).json();
    expect(body.providerConfigured).toBe(true);
  });
});

describe('GET /api/net-worth — closed accounts: register agrees with the totals', () => {
  it('still lists and still counts a row closed in the CURRENT month', async () => {
    const before = await (await GET(req())).json();
    const id = await createNetWorthAccount(
      { catalogKey: 'car', name: 'This-month car', value: 30_000 }, db);
    const thisMonth = new Date().toISOString().slice(0, 7);
    await closeNetWorthAccount(id, thisMonth, db);

    const after = await (await GET(req())).json();
    const row = after.rows.find((r: { name: string }) => r.name === 'This-month car');
    expect(row).toBeDefined();
    expect(after.totals.assets).toBe(before.totals.assets + 30_000);
  });

  it('lists and counts neither a row closed in a PRIOR month', async () => {
    const before = await (await GET(req())).json();
    const id = await createNetWorthAccount(
      { catalogKey: 'car', name: 'Old car', value: 30_000 }, db);
    await closeNetWorthAccount(id, '2020-01', db);

    const after = await (await GET(req())).json();
    const row = after.rows.find((r: { name: string }) => r.name === 'Old car');
    expect(row).toBeUndefined();
    expect(after.totals.assets).toBe(before.totals.assets);
  });
});

describe('DELETE /api/net-worth/accounts/[id]', () => {
  it('refuses with 409 once the item has history', async () => {
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Car', value: 30_000 }, db);
    const res = await DELETE(req() , { params: Promise.resolve({ id }) } as never);
    expect(res.status).toBe(409);
  });

  it('deletes an item that has never been valued', async () => {
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Typo' }, db);
    const res = await DELETE(req(), { params: Promise.resolve({ id }) } as never);
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/net-worth/accounts/[id] — valuationProvider/valuationRef', () => {
  it('persists both fields, enabling estimates for a property', async () => {
    const id = await createNetWorthAccount({ catalogKey: 'primary_residence', name: 'Persist test house' }, db);
    const res = await PATCH(
      patchReq({ valuationProvider: 'rentcast', valuationRef: '99 Elm St' }),
      { params: Promise.resolve({ id }) } as never,
    );
    expect(res.status).toBe(200);
    const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
    expect(row?.valuationProvider).toBe('rentcast');
    expect(row?.valuationRef).toBe('99 Elm St');
  });

  it('clears both fields when patched with null, turning estimates back off', async () => {
    const id = await createNetWorthAccount({ catalogKey: 'primary_residence', name: 'Clear test house' }, db);
    await PATCH(
      patchReq({ valuationProvider: 'rentcast', valuationRef: '100 Elm St' }),
      { params: Promise.resolve({ id }) } as never,
    );
    const res = await PATCH(
      patchReq({ valuationProvider: null, valuationRef: null }),
      { params: Promise.resolve({ id }) } as never,
    );
    expect(res.status).toBe(200);
    const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
    expect(row?.valuationProvider).toBeNull();
    expect(row?.valuationRef).toBeNull();
  });
});
