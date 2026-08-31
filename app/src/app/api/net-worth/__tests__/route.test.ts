import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { vi } from 'vitest';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { GET } from '../route';
import { DELETE } from '../accounts/[id]/route';
import { createNetWorthAccount } from '@/lib/netWorth/write';

const req = (url = 'http://t/api/net-worth') => new Request(url) as never;

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
