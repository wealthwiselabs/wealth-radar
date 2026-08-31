import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, balanceSnapshots } from '@/db/schema';
import { eq } from 'drizzle-orm';

const NOW = '2026-08-30T00:00:00.000Z';

function makeAccount(db: ReturnType<typeof makeTmpDb>['db'], over: Partial<typeof accounts.$inferInsert> = {}) {
  const id = randomUUID();
  db.insert(accounts).values({
    id, name: 'Home', institution: 'Manual', owner: '',
    accountClass: 'asset', purpose: 'portfolio', type: 'property',
    subtype: 'real_estate', origin: 'manual', status: 'active',
    createdAt: NOW, modifiedAt: NOW, ...over,
  }).run();
  return id;
}

describe('balance_snapshots schema', () => {
  it('stores a dated balance for an asset-class account', () => {
    const { db } = makeTmpDb();
    const accountId = makeAccount(db);
    db.insert(balanceSnapshots).values({
      id: randomUUID(), accountId, asOf: '2026-08-01', month: '2026-08',
      balance: 1150000, source: 'manual', note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    const rows = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, accountId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].balance).toBe(1150000);
  });

  it('rejects a second snapshot for the same account and date', () => {
    const { db } = makeTmpDb();
    const accountId = makeAccount(db);
    const row = {
      accountId, asOf: '2026-08-01', month: '2026-08',
      balance: 100, source: 'manual' as const, note: '', createdAt: NOW, modifiedAt: NOW,
    };
    db.insert(balanceSnapshots).values({ id: randomUUID(), ...row }).run();
    expect(() => db.insert(balanceSnapshots).values({ id: randomUUID(), ...row }).run()).toThrow();
  });

  it('accepts reviewIntervalMonths and securedByAccountId on accounts', () => {
    const { db } = makeTmpDb();
    const houseId = makeAccount(db);
    const loanId = makeAccount(db, {
      name: 'Mortgage', accountClass: 'liability', subtype: 'mortgage',
      securedByAccountId: houseId, reviewIntervalMonths: null,
    });
    db.update(accounts).set({ reviewIntervalMonths: 12 }).where(eq(accounts.id, houseId)).run();
    const house = db.select().from(accounts).where(eq(accounts.id, houseId)).get();
    const loan = db.select().from(accounts).where(eq(accounts.id, loanId)).get();
    expect(house?.reviewIntervalMonths).toBe(12);
    expect(loan?.securedByAccountId).toBe(houseId);
  });
});
