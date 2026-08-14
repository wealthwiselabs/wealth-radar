import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});
vi.mock('@/lib/backup', () => ({ snapshotDb: () => null }));

import { POST } from '../remove/route';
const NOW = '2026-08-08T00:00:00.000Z';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request('http://t', { method: 'POST' }) as never;

describe('account remove route', () => {
  it('removes an existing account and returns removed:true', async () => {
    db.insert(schema.accounts).values({ id: 'a1', name: 'x', institution: 'US Bank', accountClass: 'investment', type: 'investment', origin: 'plaid', status: 'active', purpose: 'portfolio', owner: 'Alex', createdAt: NOW, modifiedAt: NOW }).run();
    const res = await POST(req(), ctx('a1'));
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe(true);
    expect(db.select().from(schema.accounts).all().length).toBe(0);
  });
  it('404 for an unknown account', async () => {
    const res = await POST(req(), ctx('nope'));
    expect(res.status).toBe(404);
  });
});
