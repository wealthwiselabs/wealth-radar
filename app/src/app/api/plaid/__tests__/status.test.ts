import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});
vi.mock('@/lib/plaid/config', async (orig) => {
  const actual = await orig<typeof import('@/lib/plaid/config')>();
  return { ...actual, isPlaidConfigured: () => true };
});
import { GET } from '../../plaid/status/route';
const NOW = '2026-08-08T00:00:00.000Z';

describe('status route', () => {
  it('returns owner, error and needsInvestmentsConsent per item', async () => {
    db.insert(schema.plaidItems).values({ id: 'it1', plaidItemId: 'P1', institutionName: 'US Bank', owner: 'Alex', accessToken: 'enc', status: 'healthy', error: null, needsInvestmentsConsent: true, createdAt: NOW, modifiedAt: NOW }).run();
    const res = await GET();
    const body = await res.json();
    expect(body.items[0]).toMatchObject({ institutionName: 'US Bank', owner: 'Alex', needsInvestmentsConsent: true });
    expect('error' in body.items[0]).toBe(true);
  });
});
