import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { buildAllocationTree } from '@/lib/investments/allocation';
import { loadAllocationContext } from '@/lib/investments/read';
import { allocationPeriod } from '@/lib/investments/periods';
import { schema } from '@/db/client';

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
