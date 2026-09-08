import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { buildAllocationTree } from '@/lib/investments/allocation';
import { loadAllocationContext } from '@/lib/investments/read';
import { allocationPeriod } from '@/lib/investments/periods';
import { schema } from '@/db/client';
import { eq } from 'drizzle-orm';

const NOW = '2026-08-10T00:00:00.000Z';

/**
 * Reserve account, Apr 2025: 42,854.39 → 56,500.57 with ~13.5k of new money.
 * The statement recorded the deposit twice with opposite signs (external leg +
 * internal sweep leg), so a cash-flow basis sees zero flows and reports the
 * deposit as a 31.8% return. The transaction feed has the real buy.
 */
function seedReserve(db: ReturnType<typeof makeTmpDb>['db'], opts: { withBuy: boolean }) {
  db.insert(schema.accounts).values({
    id: 'a1', name: 'Brokerage', institution: 'Vanguard', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'reserve',
    owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
  db.insert(schema.securities).values({
    id: 'vusxx', ticker: 'VUSXX', name: 'VUSXX', kind: 'mutual_fund', assetType: 'money_market',
    tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
  }).run();
  const snap = (id: string, asOf: string, value: number) => {
    db.insert(schema.investmentSnapshots).values({
      id, accountId: 'a1', asOf, month: asOf.slice(0, 7), source: 'statement',
      totalValue: value, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.snapshotHoldings).values({
      id: `${id}-h`, snapshotId: id, securityId: 'vusxx', quantity: null, value,
    }).run();
  };
  snap('s0', '2025-03-31', 42854.39);
  snap('s1', '2025-04-30', 56500.57);

  const flow = (id: string, amount: number) => db.insert(schema.cashFlows).values({
    id, accountId: 'a1', securityId: null, date: '2025-04-29', amount,
    kind: amount > 0 ? 'contribution' : 'withdrawal', source: 'statement', confirmed: true,
    note: 'statement backfill', createdAt: NOW, modifiedAt: NOW,
  }).run();
  flow('f1', 13494.04);
  flow('f2', -13494.04);

  if (opts.withBuy) {
    db.insert(schema.investmentTransactions).values({
      id: 'tx1', accountId: 'a1', plaidInvestmentTxnId: 'p1', securityId: 'vusxx',
      date: '2025-04-29', name: 'Buy VUSXX', amount: 13500, quantity: null, price: null, fees: null,
      type: 'buy', subtype: 'buy', createdAt: NOW, modifiedAt: NOW,
    }).run();
  }
}

const apr25 = () => allocationPeriod('monthly', 2025, 4);

describe('root flow basis', () => {
  it('uses the buy from the transaction feed, not the offsetting statement pair', async () => {
    const { db } = makeTmpDb();
    seedReserve(db, { withBuy: true });
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, apr25(), ['reserve']);
    expect(root.roi.kind).toBe('ok');
    // (56500.57 - 42854.39 - 13500) / (42854.39 + 13500 * 1/30) ≈ 0.00338
    if (root.roi.kind === 'ok') expect(root.roi.value).toBeCloseTo(0.00338, 4);
    expect(root.gain).toBeCloseTo(146.18, 2);
  });

  it('falls back to dated external cash when the account has no exchanges', async () => {
    const { db } = makeTmpDb();
    seedReserve(db, { withBuy: false });
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, apr25(), ['reserve']);
    // No feed: the offsetting pair nets to zero, so the deposit still reads as gain.
    // Documented, not desired — it is why the feed is preferred when present.
    expect(root.gain).toBeCloseTo(13646.18, 2);
  });

  it('ignores reinvestment buys — they are return, not new money', async () => {
    const { db } = makeTmpDb();
    seedReserve(db, { withBuy: true });
    db.insert(schema.investmentTransactions).values({
      id: 'tx2', accountId: 'a1', plaidInvestmentTxnId: 'p2', securityId: 'vusxx',
      date: '2025-04-30', name: 'REINVESTMENT VANGUARD TREASURY', amount: 152.12,
      quantity: null, price: null, fees: null, type: 'buy', subtype: 'reinvest',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, apr25(), ['reserve']);
    expect(root.gain).toBeCloseTo(146.18, 2);   // unchanged by the reinvestment
  });
});

/**
 * A 401k -> Roth rollover, the shape that produced a fabricated $61.8k household
 * loss in production (Aug 2026).
 *
 * The sending 401k records the move ONLY as `cash`/`withdrawal` rows — a 401k
 * feed has no buy/sell — so under a buy/sell-only flow basis its outgoing leg is
 * invisible. The receiving Roth parks the cash and redeploys it, and those buys
 * ARE visible. The household is then charged a contribution that never happened,
 * and Modified Dietz subtracts it from the value change as if it were new money.
 *
 * Nothing entered or left the household here: both accounts are tracked, and
 * both are in the same purpose set.
 */
function seedRollover(db: ReturnType<typeof makeTmpDb>['db']) {
  const account = (id: string, name: string) => db.insert(schema.accounts).values({
    id, name, institution: 'Fidelity', accountClass: 'investment',
    type: 'investment', origin: 'plaid', status: 'active', purpose: 'portfolio',
    owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
  account('k1', '401k Old');
  account('r1', 'Roth IRA');
  db.insert(schema.securities).values({
    id: 'fund', ticker: 'FUND', name: 'FUND', kind: 'mutual_fund', assetType: 'us_equity',
    tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
  }).run();

  const snap = (id: string, accountId: string, asOf: string, value: number) => {
    db.insert(schema.investmentSnapshots).values({
      id, accountId, asOf, month: asOf.slice(0, 7), source: 'plaid',
      totalValue: value, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.snapshotHoldings).values({
      id: `${id}-h`, snapshotId: id, securityId: 'fund', quantity: null, value,
    }).run();
  };
  // 401k empties into the Roth mid-month; household ends 1,000 up on market moves.
  snap('k-open', 'k1', '2026-08-01', 100000);
  snap('k-close', 'k1', '2026-08-31', 0);
  snap('r-open', 'r1', '2026-08-01', 200000);
  snap('r-close', 'r1', '2026-08-31', 301000);

  const txn = (
    id: string, accountId: string, date: string, name: string,
    amount: number, type: string, subtype: string,
  ) => db.insert(schema.investmentTransactions).values({
    id, accountId, plaidInvestmentTxnId: id, securityId: type === 'cash' ? null : 'fund',
    date, name, amount, quantity: null, price: null, fees: null, type, subtype,
    createdAt: NOW, modifiedAt: NOW,
  }).run();

  // Plaid sign convention: positive = cash leaving the account, negative = arriving.
  txn('k-out', 'k1', '2026-08-15', 'FUND - withdrawal', 100000, 'cash', 'withdrawal');
  txn('r-in', 'r1', '2026-08-16', 'ROLLOVER CASH DIRECT ROLLOVER (Cash)', -100000, 'cash', 'deposit');
  // The Roth parks the arriving cash, then redeploys it — three buy/sell rows for
  // one real movement, which is why the buy proxy overstates so badly.
  txn('r-park', 'r1', '2026-08-16', 'MONEY MARKET - PURCHASE', 100000, 'buy', 'buy');
  txn('r-sell', 'r1', '2026-08-17', 'MONEY MARKET - REDEMPTION', -100000, 'sell', 'sell');
  txn('r-buy', 'r1', '2026-08-17', 'FUND - YOU BOUGHT', 100000, 'buy', 'buy');
}

describe('inter-account transfers', () => {
  const aug26 = () => allocationPeriod('monthly', 2026, 8);

  it('does not count a 401k -> Roth rollover as a household contribution', async () => {
    const { db } = makeTmpDb();
    seedRollover(db);
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, aug26(), ['portfolio']);
    // 300,000 -> 301,000 with no external money: a 1,000 gain, not a 99,000 loss.
    expect(root.gain).toBeCloseTo(1000, 2);
  });

  it('still counts money that genuinely entered the household', async () => {
    const { db } = makeTmpDb();
    seedRollover(db);
    // 5,000 arrives from outside and is deployed. The buy is what the
    // look-through sees; the deposit row has no partner in another account and
    // is correctly left out, so the money is counted exactly once.
    db.insert(schema.investmentTransactions).values({
      id: 'r-ext', accountId: 'r1', plaidInvestmentTxnId: 'r-ext', securityId: null,
      date: '2026-08-20', name: 'Electronic Funds Transfer Received (Cash)', amount: -5000,
      quantity: null, price: null, fees: null, type: 'cash', subtype: 'deposit',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.investmentTransactions).values({
      id: 'r-ext-buy', accountId: 'r1', plaidInvestmentTxnId: 'r-ext-buy', securityId: 'fund',
      date: '2026-08-20', name: 'FUND - YOU BOUGHT', amount: 5000,
      quantity: null, price: null, fees: null, type: 'buy', subtype: 'buy',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.update(schema.investmentSnapshots).set({ totalValue: 306000 })
      .where(eq(schema.investmentSnapshots.id, 'r-close')).run();
    db.update(schema.snapshotHoldings).set({ value: 306000 })
      .where(eq(schema.snapshotHoldings.snapshotId, 'r-close')).run();
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, aug26(), ['portfolio']);
    // Household is 6,000 up, but 5,000 of that was deposited: still a 1,000 gain.
    expect(root.gain).toBeCloseTo(1000, 2);
  });

  it('adds every leg when one rollover is split across funds', async () => {
    const { db } = makeTmpDb();
    seedRollover(db);
    // Split the 401k's single 100,000 leg into two same-day legs, the shape a
    // real 401k produces (one row per fund liquidated), and split the Roth's
    // matching deposit to go with it.
    db.delete(schema.investmentTransactions)
      .where(eq(schema.investmentTransactions.id, 'k-out')).run();
    db.delete(schema.investmentTransactions)
      .where(eq(schema.investmentTransactions.id, 'r-in')).run();
    const leg = (id: string, accountId: string, date: string, amount: number, subtype: string) =>
      db.insert(schema.investmentTransactions).values({
        id, accountId, plaidInvestmentTxnId: id, securityId: null, date,
        name: subtype === 'withdrawal' ? 'FUND - withdrawal' : 'ROLLOVER CASH (Cash)',
        amount, quantity: null, price: null, fees: null, type: 'cash', subtype,
        createdAt: NOW, modifiedAt: NOW,
      }).run();
    leg('k-out-a', 'k1', '2026-08-15', 60000, 'withdrawal');
    leg('k-out-b', 'k1', '2026-08-15', 40000, 'withdrawal');
    leg('r-in-a', 'r1', '2026-08-16', -60000, 'deposit');
    leg('r-in-b', 'r1', '2026-08-16', -40000, 'deposit');
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, aug26(), ['portfolio']);
    // Both legs have to land, or half the transfer stays counted as new money.
    expect(root.gain).toBeCloseTo(1000, 2);
  });

  it('never invents a contribution from an unmatched cash row', async () => {
    const { db } = makeTmpDb();
    seedRollover(db);
    // A fund distribution inside the Roth. It carries subtype 'deposit' like a
    // real transfer would, but nothing in another tracked account offsets it, so
    // it must not be read as new money. (A $71k in-account "DISTRIBUTION" row is
    // what made an earlier, name-blind version of this get April 2026 wrong.)
    db.insert(schema.investmentTransactions).values({
      id: 'r-dist', accountId: 'r1', plaidInvestmentTxnId: 'r-dist', securityId: null,
      date: '2026-08-21', name: 'FUND - DISTRIBUTION', amount: -71360.32,
      quantity: null, price: null, fees: null, type: 'cash', subtype: 'deposit',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, aug26(), ['portfolio']);
    expect(root.gain).toBeCloseTo(1000, 2);   // unchanged
  });

  it('treats dividends and realizedGainLoss rows as return, not capital movement', async () => {
    const { db } = makeTmpDb();
    seedRollover(db);
    const noise = (id: string, name: string, amount: number, subtype: string) =>
      db.insert(schema.investmentTransactions).values({
        id, accountId: 'r1', plaidInvestmentTxnId: id, securityId: null,
        date: '2026-08-20', name, amount, quantity: null, price: null, fees: null,
        type: 'cash', subtype, createdAt: NOW, modifiedAt: NOW,
      }).run();
    noise('n1', 'FUND - dividend', -250, 'dividend');
    noise('n2', 'FUND - realizedGainLoss', -400, 'deposit');
    noise('n3', 'FUND - realizedGainLoss', 400, 'withdrawal');
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, aug26(), ['portfolio']);
    expect(root.gain).toBeCloseTo(1000, 2);   // unchanged by any of the three
  });
});
