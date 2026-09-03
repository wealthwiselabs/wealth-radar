import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, balanceSnapshots } from '@/db/schema';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { netWorthAt, netWorthSeries } from '@/lib/netWorth/rollup';

const NOW = '2026-08-30T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function addAccount(db: Db, over: Partial<typeof accounts.$inferInsert> = {}): string {
  const id = randomUUID();
  db.insert(accounts).values({
    id, name: 'Item', institution: 'Manual', owner: '', accountClass: 'asset',
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

describe('netWorthAt', () => {
  it('subtracts liabilities from assets using derived signs', async () => {
    const { db } = makeTmpDb();
    const house = addAccount(db, { name: 'Home' });
    const mortgage = addAccount(db, { name: 'Mortgage', accountClass: 'liability', type: 'loan', subtype: 'mortgage' });
    addBalance(db, house, '2026-08-01', 1_150_000);
    addBalance(db, mortgage, '2026-08-01', 620_000);
    const totals = netWorthAt(await loadNetWorthContext(db), '2026-08-30');
    expect(totals.assets).toBe(1_150_000);
    expect(totals.liabilities).toBe(620_000);
    expect(totals.net).toBe(530_000);
  });

  it('treats a Plaid credit card balance as a liability', async () => {
    const { db } = makeTmpDb();
    const card = addAccount(db, { name: 'Card', accountClass: 'spending', type: 'credit', subtype: 'credit card' });
    addBalance(db, card, '2026-08-01', 8_400);
    const totals = netWorthAt(await loadNetWorthContext(db), '2026-08-30');
    expect(totals.liabilities).toBe(8_400);
    expect(totals.net).toBe(-8_400);
  });

  it('excludes a never-valued account and names it in missing, never summing it as zero', async () => {
    const { db } = makeTmpDb();
    const house = addAccount(db, { name: 'Home' });
    addAccount(db, { name: 'Second car', subtype: 'vehicle' });
    addBalance(db, house, '2026-08-01', 1_150_000);
    const totals = netWorthAt(await loadNetWorthContext(db), '2026-08-30');
    expect(totals.net).toBe(1_150_000);
    expect(totals.missing).toEqual(['Second car']);
  });

  it('splits assets into liquid and illiquid', async () => {
    const { db } = makeTmpDb();
    const checking = addAccount(db, { name: 'Checking', accountClass: 'spending', type: 'depository', subtype: 'checking' });
    const house = addAccount(db, { name: 'Home' });
    addBalance(db, checking, '2026-08-01', 85_000);
    addBalance(db, house, '2026-08-01', 1_150_000);
    const totals = netWorthAt(await loadNetWorthContext(db), '2026-08-30');
    expect(totals.assetsLiquid).toBe(85_000);
    expect(totals.assetsIlliquid).toBe(1_150_000);
  });

  // The sold-car regression guard. Closing must not rewrite history.
  it('drops a closed account after its closing month but keeps it before', async () => {
    const { db } = makeTmpDb();
    const car = addAccount(db, { name: 'Car', subtype: 'vehicle', status: 'closed', closedAtMonth: '2026-06' });
    addBalance(db, car, '2026-01-01', 30_000);
    const ctx = await loadNetWorthContext(db);
    expect(netWorthAt(ctx, '2026-03-31').net).toBe(30_000);
    expect(netWorthAt(ctx, '2026-06-30').net).toBe(30_000);
    expect(netWorthAt(ctx, '2026-07-31').net).toBe(0);
    expect(netWorthAt(ctx, '2026-07-31').missing).toEqual([]);
  });

  it('excludes a closed account with no closing month rather than counting it forever', async () => {
    const { db } = makeTmpDb();
    const car = addAccount(db, { name: 'Car', subtype: 'vehicle', status: 'closed', closedAtMonth: null });
    addBalance(db, car, '2026-01-01', 30_000);
    const totals = netWorthAt(await loadNetWorthContext(db), '2026-03-31');
    expect(totals.net).toBe(0);
    expect(totals.missing).toEqual([]);
  });

  // netWorthSide returns 'excluded' when accountClass matches none of its known
  // values. The accounts.account_class column is unconstrained text (no DB or
  // TS enum), so a legacy/unrecognized value is a real, reachable row shape —
  // not a contrived one. Such a row must stay out of both the totals AND
  // missing[]: it was never asked about, so it is not "unknown," it's opted out.
  it('keeps an unrecognized-accountClass account out of both the totals and missing', async () => {
    const { db } = makeTmpDb();
    const mystery = addAccount(db, { name: 'Mystery', accountClass: 'other' });
    addBalance(db, mystery, '2026-08-01', 999_999);
    const totals = netWorthAt(await loadNetWorthContext(db), '2026-08-30');
    expect(totals.net).toBe(0);
    expect(totals.assets).toBe(0);
    expect(totals.missing).toEqual([]);
  });
});

describe('netWorthSeries', () => {
  it('holds flat across a month with no new reading', async () => {
    const { db } = makeTmpDb();
    const house = addAccount(db, { name: 'Home' });
    addBalance(db, house, '2026-05-01', 1_100_000);
    addBalance(db, house, '2026-08-01', 1_150_000);
    const points = netWorthSeries(await loadNetWorthContext(db), '2026-05-01', '2026-08-31', 'monthly');
    expect(points.map((p) => p.net)).toEqual([1_100_000, 1_100_000, 1_100_000, 1_150_000]);
    expect(points[0].label).toContain('May');
  });
});
