import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { eq } from 'drizzle-orm';
import { accounts, balanceSnapshots } from '@/db/schema';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { POST } from '../estimate/route';
import { createNetWorthAccount, upsertBalanceSnapshot } from '@/lib/netWorth/write';

afterEach(() => { vi.unstubAllGlobals(); delete process.env.RENTCAST_API_KEY; });

const req = (accountId: string) => new Request('http://t/api/net-worth/estimate', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ accountId }),
}) as never;

async function house(address = '1 Main St') {
  // Name derived from the address: the shared db above persists across every
  // `it()` in this file, and `accounts_owner_institution_name_mask` is a real
  // unique index (owner, institution, name, mask) — reusing a literal 'Home'
  // name across calls would collide with itself, for reasons unrelated to the
  // valuation feature under test.
  const id = await createNetWorthAccount({ catalogKey: 'primary_residence', name: `Home (${address})` }, db);
  db.update(accounts).set({ valuationProvider: 'rentcast', valuationRef: address })
    .where(eq(accounts.id, id)).run();
  return id;
}

describe('POST /api/net-worth/estimate', () => {
  it('404s when no provider is configured', async () => {
    const id = await house();
    expect((await POST(req(id))).status).toBe(404);
  });

  it('stores the value and its range', async () => {
    process.env.RENTCAST_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ price: 1_150_000, priceRangeLow: 1_090_000, priceRangeHigh: 1_210_000 }),
      { status: 200 })));
    const id = await house('2 Main St');
    expect((await POST(req(id))).status).toBe(200);
    const row = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).get();
    expect(row?.balance).toBe(1_150_000);
    expect(row?.valueLow).toBe(1_090_000);
    expect(row?.source).toBe('estimate');
  });

  it('refuses a second refresh on the same day, protecting the free-tier quota', async () => {
    process.env.RENTCAST_API_KEY = 'k';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ price: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await house('3 Main St');
    await POST(req(id));
    expect((await POST(req(id))).status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks on a same-day manual row without ever calling the provider', async () => {
    // upsertBalanceSnapshot is guaranteed to discard an estimate over a
    // same-day manual entry, so the guard must stop before the network call —
    // otherwise a refresh burns one of RentCast's 50 monthly requests on a
    // result that can never be written.
    process.env.RENTCAST_API_KEY = 'k';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ price: 999 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await house('6 Main St');
    const today = new Date().toISOString().slice(0, 10);
    await upsertBalanceSnapshot({ accountId: id, asOf: today, balance: 1_150_000, source: 'manual' }, db);
    const res = await POST(req(id));
    expect(res.status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('writes nothing when the provider fails, leaving the item stale', async () => {
    process.env.RENTCAST_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const id = await house('4 Main St');
    expect((await POST(req(id))).status).toBe(502);
    expect(db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).all()).toHaveLength(0);
  });

  it('never overwrites a manual value entered the same day', async () => {
    process.env.RENTCAST_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ price: 999 }), { status: 200 })));
    const id = await house('5 Main St');
    const today = new Date().toISOString().slice(0, 10);
    await upsertBalanceSnapshot({ accountId: id, asOf: today, balance: 1_150_000, source: 'manual' }, db);
    await POST(req(id));
    const row = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).get();
    expect(row?.balance).toBe(1_150_000);
  });
});
