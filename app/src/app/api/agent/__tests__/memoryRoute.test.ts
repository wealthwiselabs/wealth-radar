import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { GET, DELETE } from '../memory/route';

const deleteReq = (body: unknown) =>
  new Request('http://t', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;

describe('agent memory route', () => {
  beforeEach(() => {
    db.delete(schema.agentMemory).run();
  });

  it('GET returns an empty list when nothing is stored', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).memory).toEqual([]);
  });

  it('GET returns stored entries', async () => {
    db.insert(schema.agentMemory)
      .values({ key: 'risk_tolerance', value: 'moderate', updatedAt: '2026-08-08T00:00:00.000Z' })
      .run();
    const res = await GET();
    const body = await res.json();
    expect(body.memory).toEqual([
      { key: 'risk_tolerance', value: 'moderate', updatedAt: '2026-08-08T00:00:00.000Z' },
    ]);
  });

  it('DELETE removes an existing key and reports removed:true', async () => {
    db.insert(schema.agentMemory)
      .values({ key: 'goal', value: 'retire early', updatedAt: '2026-08-08T00:00:00.000Z' })
      .run();
    const res = await DELETE(deleteReq({ key: 'goal' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: true });
    expect(db.select().from(schema.agentMemory).all()).toEqual([]);
  });

  it('DELETE reports removed:false for a missing key', async () => {
    const res = await DELETE(deleteReq({ key: 'nonexistent' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: false });
  });

  it('DELETE 400s when key is missing from the body', async () => {
    const res = await DELETE(deleteReq({}));
    expect(res.status).toBe(400);
  });
});
