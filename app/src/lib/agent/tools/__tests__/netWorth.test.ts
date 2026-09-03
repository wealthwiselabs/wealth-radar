import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { createNetWorthAccount, closeNetWorthAccount } from '@/lib/netWorth/write';
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

  // The API route (route.ts) lists a row exactly when it is counted: a closed
  // account still counts through the end of its closing month (isCountable,
  // rollup.ts). The assistant must agree with that, or it will describe the
  // net worth page differently from what it shows for up to a month after an
  // item closes.
  it('still returns an account closed in the current month, but not one closed last month', async () => {
    const today = new Date();
    const currentMonth = today.toISOString().slice(0, 7);
    const prior = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const priorMonth = prior.toISOString().slice(0, 7);

    const closedThisMonth = await createNetWorthAccount(
      { catalogKey: 'car', name: 'Sold this month', value: 5_000 }, db);
    const closedLastMonth = await createNetWorthAccount(
      { catalogKey: 'car', name: 'Sold last month', value: 7_000 }, db);
    await closeNetWorthAccount(closedThisMonth, currentMonth, db);
    await closeNetWorthAccount(closedLastMonth, priorMonth, db);

    const out = await readNetWorth();
    const names = out.rows.map((r) => r.name);
    expect(names).toContain('Sold this month');
    expect(names).not.toContain('Sold last month');
  });
});
