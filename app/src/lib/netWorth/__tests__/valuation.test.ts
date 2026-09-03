import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, balanceSnapshots, investmentSnapshots } from '@/db/schema';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { valuationAt } from '@/lib/netWorth/valuation';

const NOW = '2026-08-30T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function addAccount(db: Db, over: Partial<typeof accounts.$inferInsert> = {}): string {
  const id = randomUUID();
  db.insert(accounts).values({
    id, name: 'Home', institution: 'Manual', owner: '', accountClass: 'asset',
    purpose: 'portfolio', type: 'property', subtype: 'real_estate', origin: 'manual',
    status: 'active', createdAt: NOW, modifiedAt: NOW, ...over,
  }).run();
  return id;
}

function addBalance(db: Db, accountId: string, asOf: string, balance: number) {
  db.insert(balanceSnapshots).values({
    id: randomUUID(), accountId, asOf, month: asOf.slice(0, 7),
    balance, source: 'manual', note: '', createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('valuationAt', () => {
  it('carries the latest reading forward across a gap', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db);
    addBalance(db, id, '2026-02-01', 1_100_000);
    addBalance(db, id, '2026-08-01', 1_150_000);
    const ctx = await loadNetWorthContext(db);
    expect(valuationAt(ctx, id, '2026-05-15')).toBe(1_100_000);
    expect(valuationAt(ctx, id, '2026-08-30')).toBe(1_150_000);
  });

  it('returns null before the first reading, never zero', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db);
    addBalance(db, id, '2026-02-01', 1_100_000);
    const ctx = await loadNetWorthContext(db);
    expect(valuationAt(ctx, id, '2026-01-01')).toBeNull();
  });

  it('returns null for an account with no reading at all', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { name: 'Second car' });
    const ctx = await loadNetWorthContext(db);
    expect(valuationAt(ctx, id, '2026-08-30')).toBeNull();
  });

  it('reads an investment-class account from investment_snapshots', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { name: 'IUL', accountClass: 'investment', purpose: 'insurance', subtype: 'insurance' });
    db.insert(investmentSnapshots).values({
      id: randomUUID(), accountId: id, asOf: '2026-06-01', month: '2026-06',
      source: 'manual', totalValue: 68_000, holdingsComplete: false, note: '',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    const ctx = await loadNetWorthContext(db);
    expect(valuationAt(ctx, id, '2026-08-30')).toBe(68_000);
  });

  it('falls back to the other table when the class-preferred one is empty', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { name: 'HSA', accountClass: 'investment', subtype: 'hsa' });
    addBalance(db, id, '2026-07-01', 42_000);
    const ctx = await loadNetWorthContext(db);
    expect(valuationAt(ctx, id, '2026-08-30')).toBe(42_000);
  });

  it('falls back to investment_snapshots for a non-investment account with no balance reading', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { name: 'Old brokerage rollover', accountClass: 'asset' });
    db.insert(investmentSnapshots).values({
      id: randomUUID(), accountId: id, asOf: '2026-05-01', month: '2026-05',
      source: 'manual', totalValue: 15_000, holdingsComplete: false, note: '',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    const ctx = await loadNetWorthContext(db);
    expect(valuationAt(ctx, id, '2026-08-30')).toBe(15_000);
  });
});
