import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { vi } from 'vitest';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { POST } from '../route';

const req = (body: unknown) => new Request('http://t/api/net-worth/accounts', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}) as never;

describe('POST /api/net-worth/accounts', () => {
  // The household this was built for owns two cars — adding a second "Car"
  // without renaming it is a first-run path, not an edge case.
  it('returns 409 with an actionable message for a duplicate item name', async () => {
    const first = await POST(req({ catalogKey: 'car', name: 'Car', value: 30_000 }));
    expect(first.status).toBe(200);

    const second = await POST(req({ catalogKey: 'car', name: 'Car', value: 18_000 }));
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error).toMatch(/already have an item called "Car"/i);
  });

  // Balances are positive magnitudes; sign is derived from account class.
  // A -8000 credit card must not slip through and add to net worth.
  it('rejects a negative value with the same style of message as the snapshot route', async () => {
    const res = await POST(req({ catalogKey: 'credit_card', name: 'New card', value: -8_000 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/positive magnitude/i);
  });

  it('rejects a non-number value', async () => {
    const res = await POST(req({ catalogKey: 'credit_card', name: 'Bad card', value: 'a lot' as never }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/must be a number/i);
  });
});
