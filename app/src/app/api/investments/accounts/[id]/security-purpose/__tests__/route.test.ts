import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { PUT } from '../route';

const NOW = '2026-08-10T00:00:00.000Z';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: unknown) =>
  new Request('http://t', { method: 'PUT', body: JSON.stringify(body) }) as never;

db.insert(schema.accounts).values({
  id: 'a1', name: 'Brokerage', institution: 'Vanguard', accountClass: 'investment',
  type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
  owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
}).run();
db.insert(schema.accounts).values({
  id: 'spend', name: 'Checking', institution: 'Chase', accountClass: 'spending',
  type: 'depository', origin: 'manual', status: 'active', purpose: 'portfolio',
  owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
}).run();
db.insert(schema.securities).values({
  id: 'vusxx', ticker: 'VUSXX', name: 'VUSXX', kind: 'mutual_fund', assetType: 'money_market',
  tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
}).run();

const rows = () => db.select().from(schema.securityPurposes).all();

describe('security-purpose route', () => {
  beforeEach(() => {
    db.delete(schema.securityPurposes).run();
  });

  it('writes an override', async () => {
    const res = await PUT(req({ securityId: 'vusxx', purpose: 'reserve' }), ctx('a1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { purpose: string };
    expect(body.purpose).toBe('reserve');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].purpose).toBe('reserve');
  });

  it('overwrites rather than duplicating', async () => {
    db.insert(schema.securityPurposes).values({
      id: 'sp1', accountId: 'a1', securityId: 'vusxx', purpose: 'portfolio',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].purpose).toBe('portfolio');

    const res = await PUT(req({ securityId: 'vusxx', purpose: 'insurance' }), ctx('a1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { purpose: string };
    expect(body.purpose).toBe('insurance');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].purpose).toBe('insurance');
  });

  it('deletes the override when purpose is null', async () => {
    db.insert(schema.securityPurposes).values({
      id: 'sp2', accountId: 'a1', securityId: 'vusxx', purpose: 'reserve',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    expect(rows()).toHaveLength(1);

    const res = await PUT(req({ securityId: 'vusxx', purpose: null }), ctx('a1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { purpose: null };
    expect(body.purpose).toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it('rejects an unknown purpose', async () => {
    const res = await PUT(req({ securityId: 'vusxx', purpose: 'retirement' }), ctx('a1'));
    expect(res.status).toBe(400);
  });

  it('404s for an unknown account, a non-investment account, and an unknown security', async () => {
    expect((await PUT(req({ securityId: 'vusxx', purpose: 'reserve' }), ctx('nope'))).status).toBe(404);
    expect((await PUT(req({ securityId: 'vusxx', purpose: 'reserve' }), ctx('spend'))).status).toBe(404);
    expect((await PUT(req({ securityId: 'nope', purpose: 'reserve' }), ctx('a1'))).status).toBe(404);
  });
});
