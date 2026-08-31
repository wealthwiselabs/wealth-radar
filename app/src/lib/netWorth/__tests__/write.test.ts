import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, balanceSnapshots } from '@/db/schema';
import {
  upsertBalanceSnapshot, createNetWorthAccount, closeNetWorthAccount,
  deleteNetWorthAccount, AccountHasHistoryError,
} from '@/lib/netWorth/write';

describe('createNetWorthAccount', () => {
  it('fills class, subtype and review cadence from the catalog', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount(
      { catalogKey: 'primary_residence', name: 'Home', value: 1_150_000, asOf: '2026-08-01' }, db);
    const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
    expect(row?.accountClass).toBe('asset');
    expect(row?.subtype).toBe('real_estate');
    expect(row?.reviewIntervalMonths).toBe(12);
    const snaps = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).all();
    expect(snaps).toHaveLength(1);
    expect(snaps[0].balance).toBe(1_150_000);
  });

  it('creates an account with no snapshot when no value is given', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Second car' }, db);
    expect(db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).all()).toHaveLength(0);
  });

  it('links a mortgage to the asset securing it', async () => {
    const { db } = makeTmpDb();
    const house = await createNetWorthAccount({ catalogKey: 'primary_residence', name: 'Home', value: 1 }, db);
    const loan = await createNetWorthAccount(
      { catalogKey: 'mortgage', name: 'Mortgage', value: 620_000, securedByAccountId: house }, db);
    const row = db.select().from(accounts).where(eq(accounts.id, loan)).get();
    expect(row?.securedByAccountId).toBe(house);
    expect(row?.reviewIntervalMonths).toBeNull();
  });

  it('rejects an unknown catalog key', async () => {
    const { db } = makeTmpDb();
    await expect(createNetWorthAccount({ catalogKey: 'nope', name: 'X' }, db)).rejects.toThrow(/unknown catalog/i);
  });
});

describe('upsertBalanceSnapshot', () => {
  it('corrects the same day rather than accumulating rows', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Car' }, db);
    await upsertBalanceSnapshot({ accountId: id, asOf: '2026-08-30', balance: 25_000 }, db);
    await upsertBalanceSnapshot({ accountId: id, asOf: '2026-08-30', balance: 27_000 }, db);
    const rows = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].balance).toBe(27_000);
  });

  // Phase 3 depends on this, but the rule is cheap to enforce from the start.
  it('refuses to let an estimate overwrite a manual entry on the same day', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'primary_residence', name: 'Home' }, db);
    await upsertBalanceSnapshot({ accountId: id, asOf: '2026-08-30', balance: 1_150_000, source: 'manual' }, db);
    await upsertBalanceSnapshot({ accountId: id, asOf: '2026-08-30', balance: 999_000, source: 'estimate' }, db);
    const row = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).get();
    expect(row?.balance).toBe(1_150_000);
    expect(row?.source).toBe('manual');
  });

  it('lets a manual entry overwrite an estimate', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'primary_residence', name: 'Home' }, db);
    await upsertBalanceSnapshot({ accountId: id, asOf: '2026-08-30', balance: 999_000, source: 'estimate' }, db);
    await upsertBalanceSnapshot({ accountId: id, asOf: '2026-08-30', balance: 1_150_000, source: 'manual' }, db);
    const row = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).get();
    expect(row?.balance).toBe(1_150_000);
  });
});

describe('removal', () => {
  it('closes an account without touching its history', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Car', value: 30_000, asOf: '2026-01-01' }, db);
    await closeNetWorthAccount(id, '2026-06', db);
    const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
    expect(row?.status).toBe('closed');
    expect(row?.closedAtMonth).toBe('2026-06');
    expect(db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).all()).toHaveLength(1);
  });

  it('deletes an account that has never been valued', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Typo' }, db);
    await deleteNetWorthAccount(id, db);
    expect(db.select().from(accounts).where(eq(accounts.id, id)).all()).toHaveLength(0);
  });

  it('refuses to delete an account with history', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Car', value: 30_000 }, db);
    await expect(deleteNetWorthAccount(id, db)).rejects.toBeInstanceOf(AccountHasHistoryError);
  });
});
