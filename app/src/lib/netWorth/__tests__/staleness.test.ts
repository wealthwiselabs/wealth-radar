// app/src/lib/netWorth/__tests__/staleness.test.ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, balanceSnapshots } from '@/db/schema';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { staleAccounts } from '@/lib/netWorth/staleness';

const NOW = '2026-08-30T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function addAccount(db: Db, over: Partial<typeof accounts.$inferInsert> = {}): string {
  const id = randomUUID();
  db.insert(accounts).values({
    id, name: 'Home', institution: 'Manual', owner: '', accountClass: 'asset',
    purpose: 'portfolio', type: 'property', subtype: 'real_estate', origin: 'manual',
    status: 'active', reviewIntervalMonths: 12, createdAt: NOW, modifiedAt: NOW, ...over,
  }).run();
  return id;
}

function addBalance(db: Db, accountId: string, asOf: string, balance: number) {
  db.insert(balanceSnapshots).values({
    id: randomUUID(), accountId, asOf, month: asOf.slice(0, 7),
    balance, source: 'manual', note: '', createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('staleAccounts', () => {
  it('reports an account past its review interval', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { reviewIntervalMonths: 6 });
    addBalance(db, id, '2026-01-01', 1_100_000);
    const stale = staleAccounts(await loadNetWorthContext(db), '2026-08-30');
    expect(stale).toHaveLength(1);
    expect(stale[0].monthsOverdue).toBe(1);
    expect(stale[0].lastAsOf).toBe('2026-01-01');
  });

  it('does not report an account exactly at its interval', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { reviewIntervalMonths: 6 });
    addBalance(db, id, '2026-02-28', 1_100_000);
    expect(staleAccounts(await loadNetWorthContext(db), '2026-08-30')).toEqual([]);
  });

  it('never reports an account with a null interval', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { name: 'Checking', reviewIntervalMonths: null });
    addBalance(db, id, '2020-01-01', 85_000);
    expect(staleAccounts(await loadNetWorthContext(db), '2026-08-30')).toEqual([]);
  });

  it('reports a never-valued account with a null lastAsOf', async () => {
    const { db } = makeTmpDb();
    addAccount(db, { name: 'Second car', reviewIntervalMonths: 12 });
    const stale = staleAccounts(await loadNetWorthContext(db), '2026-08-30');
    expect(stale[0].lastAsOf).toBeNull();
  });

  it('ignores closed accounts', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { name: 'Old car', status: 'closed', closedAtMonth: '2026-06' });
    addBalance(db, id, '2020-01-01', 30_000);
    expect(staleAccounts(await loadNetWorthContext(db), '2026-08-30')).toEqual([]);
  });
});
