import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { createNetWorthAccount } from '@/lib/netWorth/write';
import { readNetWorth } from '@/lib/agent/tools/read';

describe('net_worth agent tool', () => {
  it('reports the current figure, its parts, and what is excluded', async () => {
    await createNetWorthAccount({ catalogKey: 'primary_residence', name: 'Home', value: 1_150_000 }, db);
    await createNetWorthAccount({ catalogKey: 'mortgage', name: 'Mortgage', value: 620_000 }, db);
    await createNetWorthAccount({ catalogKey: 'car', name: 'Second car' }, db);

    const out = await readNetWorth();
    expect(out.net).toBe(530_000);
    expect(out.assets).toBe(1_150_000);
    expect(out.liabilities).toBe(620_000);
    expect(out.missing).toEqual(['Second car']);
  });
});
