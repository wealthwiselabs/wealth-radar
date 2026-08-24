import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { buildAllocationWindowTree } from '@/lib/investments/allocation';
import { loadAllocationContext } from '@/lib/investments/read';
import { schema } from '@/db/client';

const NOW = '2026-08-10T00:00:00.000Z';

/**
 * Reproduces the reported bug: statement/manual 401k accounts (no Plaid
 * transaction feed) are fully liquidated mid-year and rolled into a Roth IRA
 * that buys VGT (US tech). The "Asset snapshot — This Year" table shows large
 * spurious negative ROIs for Bond and Sector: Tech because the roll-out
 * withdrawal is dropped (close holdings are empty → pro-rata denominator is 0),
 * so Modified Dietz reads the vanished holdings as a loss.
 */
function seed(db: ReturnType<typeof makeTmpDb>['db']) {
  const acct = (id: string, name: string) =>
    db.insert(schema.accounts).values({
      id, name, institution: 'Fidelity', accountClass: 'investment',
      type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
    }).run();
  acct('old401k', 'Ironclad 401k');
  acct('rothIRA', 'Roth IRA');

  const sec = (id: string, ticker: string, assetType: string, sector: string | null) =>
    db.insert(schema.securities).values({
      id, ticker, name: ticker, kind: 'mutual_fund', assetType,
      region: assetType === 'equity' ? 'us' : null, sector,
      tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
    }).run();
  sec('bnd', 'BND', 'bond', null);
  sec('tech401k', 'FTEC', 'equity', 'technology');
  sec('vgt', 'VGT', 'equity', 'technology');

  const snap = (id: string, accountId: string, asOf: string, complete: boolean,
    holdings: Array<{ securityId: string; value: number }>) => {
    const total = holdings.reduce((s, h) => s + h.value, 0);
    db.insert(schema.investmentSnapshots).values({
      id, accountId, asOf, month: asOf.slice(0, 7), source: 'statement',
      totalValue: total, holdingsComplete: complete, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    holdings.forEach((h, i) => db.insert(schema.snapshotHoldings).values({
      id: `${id}-h${i}`, snapshotId: id, securityId: h.securityId, quantity: null, value: h.value,
    }).run());
  };

  // old401k: starts the year with bonds + tech, fully liquidated by mid-year.
  snap('o0', 'old401k', '2025-12-31', true, [
    { securityId: 'bnd', value: 50000 }, { securityId: 'tech401k', value: 50000 },
  ]);
  snap('o1', 'old401k', '2026-07-31', true, []); // liquidated → empty but complete

  // rothIRA: opens the year empty, receives the rollover, buys VGT.
  snap('r0', 'rothIRA', '2025-12-31', true, []);
  snap('r1', 'rothIRA', '2026-07-31', true, [{ securityId: 'vgt', value: 105000 }]);

  // Account-level cash flows (statement basis — NO investment_transactions feed).
  const flow = (id: string, accountId: string, amount: number) =>
    db.insert(schema.cashFlows).values({
      id, accountId, securityId: null, date: '2026-06-15', amount,
      kind: amount > 0 ? 'contribution' : 'withdrawal', source: 'statement', confirmed: true,
      note: 'rollover', createdAt: NOW, modifiedAt: NOW,
    }).run();
  flow('f-out', 'old401k', -100000); // rolled out of the 401k
  flow('f-in', 'rothIRA', 100000);   // rolled into the IRA
}

describe('full liquidation + cross-account rollover (statement basis)', () => {
  it('does not report a spurious catastrophic loss on the liquidated Bond class', async () => {
    const { db } = makeTmpDb();
    seed(db);
    const ctx = await loadAllocationContext(db);
    const tree = buildAllocationWindowTree(ctx, '2026-01-01', '2026-08-10', ['portfolio']);

    const bond = tree.children.find((c) => c.label === 'Bond');
    // The bonds were SOLD, not lost: the −50k roll-out nets the −50k value drop,
    // so the honest return is ~0 — not the ~−100% the dropped-flow bug produced.
    expect(bond?.roi.kind).toBe('ok');
    if (bond?.roi.kind === 'ok') expect(bond.roi.value).toBeCloseTo(0, 5);
    expect(bond?.contributions).toBeCloseTo(-50000, 2);
  });

  it('does not report a spurious catastrophic loss on the Tech class after the move', async () => {
    const { db } = makeTmpDb();
    seed(db);
    const ctx = await loadAllocationContext(db);
    const tree = buildAllocationWindowTree(ctx, '2026-01-01', '2026-08-10', ['portfolio']);

    const stock = tree.children.find((c) => c.label === 'Stock');
    const us = stock?.children.find((c) => c.label === 'US');
    const tech = us?.children.find((c) => c.label === 'Sector: Tech');
    // Old tech was sold (−50k, netted) and VGT bought (+100k, rose to 105k):
    // a modest positive return, not the −74% the blended dropped-flow bug showed.
    expect(tech?.roi.kind).toBe('ok');
    if (tech?.roi.kind === 'ok') {
      expect(tech.roi.value).toBeGreaterThan(0);
      expect(tech.roi.value).toBeLessThan(0.2);
    }
  });
});
