import { describe, it, expect } from 'vitest';
import { bucketPath, type TagSet } from '@/lib/investments/allocation';

const t = (o: Partial<TagSet>): TagSet =>
  ({ assetType: 'other', region: null, cap: null, style: null, sector: null, ...o });

describe('bucketPath', () => {
  it('nests US equity Class → Region → Cap → Style', () => {
    expect(bucketPath(t({ assetType: 'equity', region: 'us', cap: 'large', style: 'value' })))
      .toEqual(['Stock', 'US', 'Large Cap', 'Value']);
  });
  it('collapses on a null tag', () => {
    expect(bucketPath(t({ assetType: 'equity', region: 'us', cap: 'large' })))
      .toEqual(['Stock', 'US', 'Large Cap']);              // no style child
    expect(bucketPath(t({ assetType: 'equity', region: 'us' })))
      .toEqual(['Stock', 'US']);                            // no cap child
  });
  it('places a sector holding under US Stock, not its cap', () => {
    expect(bucketPath(t({ assetType: 'equity', region: 'us', cap: 'large', sector: 'technology' })))
      .toEqual(['Stock', 'US', 'Sector: Tech']);
    expect(bucketPath(t({ assetType: 'equity', region: 'us', sector: 'real_estate' })))
      .toEqual(['Stock', 'US', 'Sector: REIT']);
  });
  it('splits international by region', () => {
    expect(bucketPath(t({ assetType: 'equity', region: 'intl_developed' })))
      .toEqual(['Stock', 'International', 'Developed']);
    expect(bucketPath(t({ assetType: 'equity', region: 'intl_emerging' })))
      .toEqual(['Stock', 'International', 'Emerging']);
  });
  it('treats bond, cash, money market as flat leaves', () => {
    expect(bucketPath(t({ assetType: 'bond' }))).toEqual(['Bond']);
    expect(bucketPath(t({ assetType: 'money_market' }))).toEqual(['Money market']);
    expect(bucketPath(t({ assetType: 'cash' }))).toEqual(['Cash']);
  });
  it('routes an untagged/other holding to Unclassified', () => {
    expect(bucketPath(t({ assetType: 'other' }))).toEqual(['Unclassified']);
  });
  it('routes individual stocks into their own group keyed by ticker', () => {
    expect(bucketPath(t({ assetType: 'equity', kind: 'stock', ticker: 'RBLX', region: 'us', cap: 'mid', style: 'growth' })))
      .toEqual(['Stock', 'Individual Stocks', 'RBLX']);
  });
  it('falls back to the security name when an individual stock has no ticker', () => {
    expect(bucketPath(t({ assetType: 'equity', kind: 'stock', ticker: null, name: 'Private Co' })))
      .toEqual(['Stock', 'Individual Stocks', 'Private Co']);
  });
  it('leaves funds/ETFs on the region/cap/style tree', () => {
    expect(bucketPath(t({ assetType: 'equity', kind: 'etf', region: 'us', cap: 'large', style: 'growth' })))
      .toEqual(['Stock', 'US', 'Large Cap', 'Growth']);
  });
});

import { makeTmpDb } from '@/test/tmpDb';
import { importLegacyQuarters, type LegacyClassRow } from '@/lib/investments/legacyImport';
import { loadAllocationContext } from '@/lib/investments/read';
import { buildAllocationTree } from '@/lib/investments/allocation';
import { allocationPeriod } from '@/lib/investments/periods';
import { accounts } from '@/db/schema';

const NOW = '2026-08-05T00:00:00.000Z';
function seedHH(db: ReturnType<typeof makeTmpDb>['db']) {
  db.insert(accounts).values({
    id: 'hh', name: 'Household', institution: 'Legacy', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    createdAt: NOW, modifiedAt: NOW,
  }).run();
}

// Minimal 2025 Q1 fixture: the classes needed to prove each node + Bond contribution.
const Q1_FIXTURE: LegacyClassRow[] = [
  { className: 'Bond', quarters: [{ label: 'Q1', start: '2025-01-01', end: '2025-03-31', startValue: 180131.35, endValue: 206940.09, contributions: 23100.09 }] },
  { className: 'L-Cap Value', quarters: [{ label: 'Q1', start: '2025-01-01', end: '2025-03-31', startValue: 352530.78, endValue: 317473.11, contributions: 0 }] },
  { className: 'L-Cap Growth', quarters: [{ label: 'Q1', start: '2025-01-01', end: '2025-03-31', startValue: 406793.94, endValue: 326809.69, contributions: 0 }] },
  { className: 'Total US Index', quarters: [{ label: 'Q1', start: '2025-01-01', end: '2025-03-31', startValue: 161348.72, endValue: 135885.62, contributions: 0 }] },
  { className: 'Small Cap Index', quarters: [{ label: 'Q1', start: '2025-01-01', end: '2025-03-31', startValue: 257998.99, endValue: 210844.85, contributions: 0 }] },
  { className: 'S-Cap Value', quarters: [{ label: 'Q1', start: '2025-01-01', end: '2025-03-31', startValue: 72473.73, endValue: 59756.01, contributions: 0 }] },
  { className: 'S-Cap Growth', quarters: [{ label: 'Q1', start: '2025-01-01', end: '2025-03-31', startValue: 79810.69, endValue: 62922.65, contributions: 0 }] },
  { className: 'Intl Dev Mkt', quarters: [{ label: 'Q1', start: '2025-01-01', end: '2025-03-31', startValue: 99281.87, endValue: 96489.58, contributions: 0 }] },
  // Needed so the fixture's root total matches the full household sheet (root ROI golden below).
  { className: 'Intl EMG Mkt', quarters: [{ label: 'Q1', start: '2025-01-01', end: '2025-03-31', startValue: 65078.04, endValue: 63151.74, contributions: 0 }] },
];

function findNode(root: import('@/lib/investments/allocation').AllocNode, path: string[]) {
  let n = root;
  for (const label of path) { n = n.children.find((c) => c.label === label)!; }
  return n;
}
const roi = (n: import('@/lib/investments/allocation').AllocNode) => n.roi.kind === 'ok' ? n.roi.value : NaN;

describe('buildAllocationTree — 2025 Q1 golden (net ROI)', () => {
  it('reproduces the sheet per-node ROI, Bond contribution-adjusted', async () => {
    const { db } = makeTmpDb();
    seedHH(db);
    await importLegacyQuarters('hh', Q1_FIXTURE, db);
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, allocationPeriod('quarterly', 2025, 1));

    expect(roi(findNode(root, ['Stock', 'US', 'Large Cap']))).toBeCloseTo(-0.1526, 4);
    expect(roi(findNode(root, ['Stock', 'US', 'Small Cap']))).toBeCloseTo(-0.1871, 4);
    expect(roi(findNode(root, ['Stock', 'International', 'Developed']))).toBeCloseTo(-0.0281, 4);
    expect(roi(findNode(root, ['Bond']))).toBeCloseTo(0.0182, 4);   // NET, not the +14.9% gross

    // Root ROI is net of all portfolio-account flows in the period, not gross.
    expect(root.roi.kind).toBe('ok');
    if (root.roi.kind === 'ok') expect(root.roi.value).toBeCloseTo(-0.1285, 4);

    // % of total at the end date sums to 100 across the top level.
    const topPct = root.children.reduce((s, c) => s + (c.pctOfTotal ?? 0), 0);
    expect(topPct).toBeCloseTo(1, 6);
    // Balance aggregates upward: US Large Cap end = 317473.11 + 326809.69 + 135885.62.
    expect(findNode(root, ['Stock', 'US', 'Large Cap']).balance).toBeCloseTo(780168.42, 2);
  });
});

import { nodeTrendSeries } from '@/lib/investments/allocation';
import type { AllocContext } from '@/lib/investments/allocation';

describe('buildAllocationTree — boundary-account contribution gating', () => {
  it('excludes a portfolio flow from an account with no in-period boundary snapshots', () => {
    const period = allocationPeriod('quarterly', 2025, 1);   // 2025-01-01 .. 2025-03-31
    const ctx: AllocContext = {
      snapshots: [
        // Account L (Legacy-like): complete start+end snapshot pair inside the quarter.
        {
          id: 's-L-open', accountId: 'L', asOf: '2025-01-01', month: '2025-01',
          source: 'manual', totalValue: 1000, holdingsComplete: true,
          holdings: [{ securityId: 'sec1', quantity: null, value: 1000 }],
        },
        {
          id: 's-L-close', accountId: 'L', asOf: '2025-03-31', month: '2025-03',
          source: 'manual', totalValue: 1100, holdingsComplete: true,
          holdings: [{ securityId: 'sec1', quantity: null, value: 1100 }],
        },
        // Account F (live-like) has NO snapshots at all in the period.
      ],
      accountPurposes: new Map([['L', 'portfolio'], ['F', 'portfolio']]),
      overrides: [],
      flows: [
        { id: 'f-L', accountId: 'L', date: '2025-02-01', amount: 50, kind: 'contribution', securityId: null },
        { id: 'f-F', accountId: 'F', date: '2025-02-15', amount: 500, kind: 'contribution', securityId: null },
      ],
      tagsBySecurity: new Map([
        ['sec1', { assetType: 'equity', region: 'us', cap: 'large', style: null, sector: null }],
      ]),
      exchanges: [],
      accountLabels: new Map(),
    };

    const root = buildAllocationTree(ctx, period);
    // Only L's flow (50) counts; F's flow (500) is excluded because F has no
    // boundary snapshots in the period, even though its flow falls inside [t0,t1].
    expect(root.contributions).toBe(50);
  });
});

describe('year + trend', () => {
  it('a year node ROI chains its quarters', async () => {
    // Two-quarter fixture for one class so the chain is easy to assert.
    const { db } = makeTmpDb(); seedHH(db);
    const TWO_Q: LegacyClassRow[] = [{ className: 'Bond', quarters: [
      { label: 'Q1', start: '2025-01-01', end: '2025-03-31', startValue: 100000, endValue: 110000, contributions: 0 },
      { label: 'Q2', start: '2025-04-01', end: '2025-06-30', startValue: 110000, endValue: 121000, contributions: 0 },
    ]}];
    await importLegacyQuarters('hh', TWO_Q, db);
    const ctx = await loadAllocationContext(db);
    const year = buildAllocationTree(ctx, allocationPeriod('yearly', 2025, 0));
    const bond = year.children.find((c) => c.label === 'Bond')!;
    // Q1 +10%, Q2 +10% → chained +21%. Q3/Q4 missing → fidelity flag but chain over present quarters.
    // With only Q1,Q2 present the year chains those two: (1.1*1.1)-1 = 0.21.
    expect(bond.roi.kind).toBe('ok');
    if (bond.roi.kind === 'ok') expect(bond.roi.value).toBeCloseTo(0.21, 6);
    expect(bond.fidelity).toBe('chained');
  });

  it('nodeTrendSeries returns a value point per period', async () => {
    const { db } = makeTmpDb(); seedHH(db);
    await importLegacyQuarters('hh', [{ className: 'Bond', quarters: [
      { label: 'Q1', start: '2025-01-01', end: '2025-03-31', startValue: 100000, endValue: 110000, contributions: 0 },
      { label: 'Q2', start: '2025-04-01', end: '2025-06-30', startValue: 110000, endValue: 121000, contributions: 0 },
    ]}], db);
    const ctx = await loadAllocationContext(db);
    const pts = nodeTrendSeries(ctx, ['Bond'], 'quarterly', '2025-01-01', '2025-06-30');
    expect(pts.map((p) => p.label)).toEqual(['2025 Q1', '2025 Q2']);
    expect(pts[1].value).toBeCloseTo(121000, 2);   // period-end balance
  });
});

describe('chained (yearly) gain', () => {
  // Four back-to-back quarters, ONE account holding two securities — Bond
  // (portfolio, default) and a money-market fund overridden to `reserve` —
  // so the account is mixed-purpose. Root and Bond (both target-filtered to
  // `portfolio`, so both effectively track Bond alone) should each equal the
  // plain sum of the four quarters' own gains, not an independently-computed
  // year-level figure.
  //
  // This specifically needs the mm holding's weight relative to Bond to
  // DIFFER between Q2's own close (Jun 30) and the year's own close (Dec
  // 31): the mid-year account-level flow (no securityId) is pro-rated by
  // `rootFlows` using the target's share of ALL close holdings (Bond+mm),
  // and that share is 112000/192000 at Q2's close vs 130000/210000 at the
  // year's close — genuinely different dollar amounts. A fixture with no
  // flow (or a single-security account, where the share is always 1) cannot
  // discriminate here: year's own `e − s − flowTotal` telescopes to exactly
  // the same number as the summed quarters by simple arithmetic regardless
  // of flow placement, so the pre-fix (year's-own-computation) implementation
  // passes it — see the RED/GREEN evidence in the fix report for this test.
  it("sums each quarter's gain for both the root and a sub-node, using pro-rata share at each quarter's own close", () => {
    const tags = new Map([
      ['b1', t({ assetType: 'bond' })],
      ['mm1', t({ assetType: 'money_market' })],
    ]);
    const snaps = [
      rsnap('a1', '2025-01-01', [{ securityId: 'b1', value: 100000 }, { securityId: 'mm1', value: 50000 }]),
      rsnap('a1', '2025-03-31', [{ securityId: 'b1', value: 105000 }, { securityId: 'mm1', value: 50000 }]),  // Q1 gain 5000 (no flow)
      rsnap('a1', '2025-04-01', [{ securityId: 'b1', value: 105000 }, { securityId: 'mm1', value: 50000 }]),
      rsnap('a1', '2025-06-30', [{ securityId: 'b1', value: 112000 }, { securityId: 'mm1', value: 80000 }]),  // Q2 close: Bond share 112000/192000
      rsnap('a1', '2025-07-01', [{ securityId: 'b1', value: 112000 }, { securityId: 'mm1', value: 80000 }]),
      rsnap('a1', '2025-09-30', [{ securityId: 'b1', value: 120000 }, { securityId: 'mm1', value: 80000 }]), // Q3 gain 8000 (no flow)
      rsnap('a1', '2025-10-01', [{ securityId: 'b1', value: 120000 }, { securityId: 'mm1', value: 80000 }]),
      rsnap('a1', '2025-12-31', [{ securityId: 'b1', value: 130000 }, { securityId: 'mm1', value: 80000 }]), // Q4 gain 10000 (no flow); year close: Bond share 130000/210000
    ];
    const flows: AllocContext['flows'] = [
      { id: 'f1', accountId: 'a1', securityId: null, date: '2025-04-15', amount: 6000, kind: 'contribution' },
    ];
    const ctx: AllocContext = {
      snapshots: snaps,
      accountPurposes: new Map([['a1', 'portfolio']]),
      overrides: [{ accountId: 'a1', securityId: 'mm1', purpose: 'reserve' }],
      flows,
      tagsBySecurity: tags,
      exchanges: [],
      accountLabels: new Map(),
    };
    const year = buildAllocationTree(ctx, allocationPeriod('yearly', 2025, 0));
    expect(year.fidelity).toBe('chained');
    expect(year.roi.kind).toBe('ok');

    // Q2's flow share: 6000 * (112000 / 192000) = 3500 -> Q2 gain = (112000-105000) - 3500 = 3500.
    // Chained root gain = 5000 (Q1) + 3500 (Q2) + 8000 (Q3) + 10000 (Q4) = 26500.
    // (The year's OWN naive e-s-flowTotal uses the year-close share instead —
    // 6000*(130000/210000)=3714.2857 -> 30000-3714.2857=26285.7143 — a
    // different number. See the fix report for the reverted-code RED proof.)
    expect(year.gain).toBeCloseTo(26500, 6);

    const bond = year.children.find((c) => c.label === 'Bond')!;
    expect(bond.fidelity).toBe('chained');
    // Bond is the account's ONLY target-purpose (portfolio) holding, so the
    // class-level pro-rata share (target-filtered closeTotal) is always 1:
    // Bond's flow is the flow's FULL, un-prorated amount in whichever
    // quarter it falls (Q2), same telescoping result either way — this
    // assertion doesn't discriminate root vs. naive on its own, but it does
    // confirm chaining still reconciles for a sub-node once a flow exists.
    expect(bond.gain).toBeCloseTo(24000, 6);   // 5000 + (7000-6000) + 8000 + 10000
  });

  it("is null when one quarter's boundary can't be resolved, even though roi still chains over the rest", () => {
    const tags = new Map([['b1', t({ assetType: 'bond' })]]);
    const snaps = [
      rsnap('a1', '2025-01-01', [{ securityId: 'b1', value: 100000 }]),
      rsnap('a1', '2025-03-31', [{ securityId: 'b1', value: 105000 }]),   // Q1 resolves, gain 5000
      rsnap('a1', '2025-04-01', [{ securityId: 'b1', value: 105000 }]),
      // Q2's close is 20 days early (still within Q2's own +-20d tolerance of
      // Jun 30) but 21 days from Q3's Jul 1 open — outside Q3's tolerance, so
      // it does NOT leak into Q3 and give it a phantom boundary.
      rsnap('a1', '2025-06-10', [{ securityId: 'b1', value: 112000 }]),   // Q2 resolves, gain 7000
      // No snapshot anywhere near Q3 (Jul 1 .. Sep 30): Q3 has neither open
      // nor close, so its own tree's root/Bond balance and gain are null.
      // Q4's open is 20 days late (within Q4's own tolerance of Oct 1) but 21
      // days from Q3's Sep 30 close — outside Q3's tolerance.
      rsnap('a1', '2025-10-21', [{ securityId: 'b1', value: 120000 }]),
      rsnap('a1', '2025-12-31', [{ securityId: 'b1', value: 130000 }]),   // Q4 resolves, gain 10000
    ];
    const year = buildAllocationTree(rangeCtx(snaps, [], tags), allocationPeriod('yearly', 2025, 0));
    // roi still chains over the three resolvable quarters (existing behavior) —
    // it is NOT null just because one quarter is missing.
    expect(year.roi.kind).toBe('ok');
    // gain, however, cannot honestly sum a missing quarter's dollar movement,
    // so the whole chained figure goes null rather than silently under-counting.
    expect(year.gain).toBeNull();

    const bond = year.children.find((c) => c.label === 'Bond')!;
    expect(bond.gain).toBeNull();
  });
});

import { buildAllocationWindowTree } from '@/lib/investments/allocation';
import type { SnapshotWithHoldings } from '@/lib/investments/snapshots';

function rangeCtx(snapshots: SnapshotWithHoldings[], flows: AllocContext['flows'] = [], tags = new Map()): AllocContext {
  return { snapshots, accountPurposes: new Map(), overrides: [], flows, tagsBySecurity: tags, exchanges: [], accountLabels: new Map() };
}
function rsnap(accountId: string, asOf: string, holdings: { securityId: string; value: number }[]): SnapshotWithHoldings {
  return {
    id: `${accountId}-${asOf}`, accountId, asOf, month: asOf.slice(0, 7), source: 'statement',
    totalValue: holdings.reduce((s, h) => s + h.value, 0), holdingsComplete: true,
    holdings: holdings.map((h) => ({ securityId: h.securityId, quantity: null, value: h.value })),
  };
}

describe('buildAllocationWindowTree (equivalent of the former YTD trailing range)', () => {
  it('carries the last snapshot forward to the window start and computes window ROI', () => {
    const tags = new Map([['s1', t({ assetType: 'equity', region: 'us', cap: 'large', style: 'blend' })]]);
    const snaps = [
      rsnap('a1', '2025-12-31', [{ securityId: 's1', value: 1000 }]), // before YTD start → carry-forward open
      rsnap('a1', '2026-07-31', [{ securityId: 's1', value: 1200 }]), // latest → close
    ];
    const tree = buildAllocationWindowTree(rangeCtx(snaps, [], tags), '2026-01-01', '2026-08-07');
    expect(tree.startBalance).toBe(1000);
    expect(tree.balance).toBe(1200);
    expect(tree.valueChange).toBe(200);
    expect(tree.roi).toEqual({ kind: 'ok', value: 0.2 });
    expect(tree.children.map((c) => c.label)).toEqual(['Stock']);
  });
});

describe('nodeTrendSeries Total line (carry-forward)', () => {
  it('carries the household balance forward across a gap month (no null point)', () => {
    const snaps = [
      rsnap('a1', '2025-07-31', [{ securityId: 's1', value: 1000 }]),
      rsnap('a1', '2025-09-30', [{ securityId: 's1', value: 1200 }]), // Aug missing (combined statement)
    ];
    const pts = nodeTrendSeries(rangeCtx(snaps), [], 'monthly', '2025-07-01', '2025-09-30');
    const byKey = Object.fromEntries(pts.map((p) => [p.periodKey, p.value]));
    expect(byKey['monthly:2025-07']).toBe(1000);
    expect(byKey['monthly:2025-08']).toBe(1000); // carried forward, not a gap
    expect(byKey['monthly:2025-09']).toBe(1200);
  });
});

describe('nodeTrendSeries sub-node carry-forward (overlays)', () => {
  it('carries a Bond overlay value forward across gap months', () => {
    const tags = new Map([['b1', t({ assetType: 'bond' })]]);
    const snaps = [
      rsnap('a1', '2025-03-31', [{ securityId: 'b1', value: 500 }]),
      rsnap('a1', '2025-06-30', [{ securityId: 'b1', value: 600 }]), // Apr/May have no snapshot
    ];
    const pts = nodeTrendSeries(rangeCtx(snaps, [], tags), ['Bond'], 'monthly', '2025-03-01', '2025-06-30');
    const byKey = Object.fromEntries(pts.map((p) => [p.periodKey, p.value]));
    expect(byKey['monthly:2025-03']).toBe(500);
    expect(byKey['monthly:2025-04']).toBe(500); // carried forward (was a gap before)
    expect(byKey['monthly:2025-05']).toBe(500);
    expect(byKey['monthly:2025-06']).toBe(600);
  });
});

describe('allocation contributions + cash-equivalent ROI', () => {
  it('distributes an account-level contribution pro-rata so class contribs reconcile with root', () => {
    const tags = new Map([
      ['sEq', t({ assetType: 'equity', region: 'us', cap: 'large', style: 'blend' })],
      ['sBond', t({ assetType: 'bond' })],
    ]);
    const snaps = [
      rsnap('a1', '2025-12-31', [{ securityId: 'sEq', value: 500 }, { securityId: 'sBond', value: 500 }]),
      rsnap('a1', '2026-07-31', [{ securityId: 'sEq', value: 600 }, { securityId: 'sBond', value: 400 }]), // close 60/40
    ];
    const flows = [{ id: 'f', accountId: 'a1', date: '2026-03-01', amount: 100, kind: 'contribution', securityId: null }];
    const tree = buildAllocationWindowTree(rangeCtx(snaps, flows, tags), '2026-01-01', '2026-08-07');
    expect(tree.contributions).toBeCloseTo(100, 6);
    const byLabel = Object.fromEntries(tree.children.map((c) => [c.label, c.contributions ?? 0]));
    expect(byLabel['Stock']).toBeCloseTo(60, 6);   // distributed by close value (600/1000)
    expect(byLabel['Bond']).toBeCloseTo(40, 6);
    const sumKids = tree.children.reduce((s, c) => s + (c.contributions ?? 0), 0);
    expect(sumKids).toBeCloseTo(tree.contributions ?? 0, 6); // reconciles with root
  });

  it('suppresses ROI for a cash-equivalent (money market) node', () => {
    const tags = new Map([['mm', t({ assetType: 'money_market' })]]);
    const snaps = [
      rsnap('a1', '2025-12-31', [{ securityId: 'mm', value: 1000 }]),
      rsnap('a1', '2026-07-31', [{ securityId: 'mm', value: 1500 }]),
    ];
    const tree = buildAllocationWindowTree(rangeCtx(snaps, [], tags), '2026-01-01', '2026-08-07');
    const mm = tree.children.find((c) => c.label === 'Money market')!;
    expect(mm.roi.kind).toBe('missing');
  });
});

import { classExchangeFlows, accountHasExchanges } from '@/lib/investments/allocation';

describe('classExchangeFlows (look-through)', () => {
  it('maps buys/sells to class paths, excludes reinvestments, scoped to account+window', () => {
    const ctx = rangeCtx([], [], new Map([
      ['sVTI', t({ assetType: 'equity', region: 'us', cap: 'large', style: 'blend' })],
      ['sMM', t({ assetType: 'money_market' })],
    ]));
    ctx.exchanges = [
      { accountId: 'a1', securityId: 'sVTI', date: '2026-03-01', amount: 1000, type: 'buy', name: 'YOU BOUGHT VTI' },
      { accountId: 'a1', securityId: 'sVTI', date: '2026-03-05', amount: 5, type: 'buy', name: 'REINVESTMENT VTI' }, // excluded
      { accountId: 'a1', securityId: 'sMM', date: '2026-03-01', amount: -1000, type: 'sell', name: 'YOU SOLD SPAXX' },
      { accountId: 'a1', securityId: 'sVTI', date: '2025-01-01', amount: 50, type: 'buy', name: 'YOU BOUGHT VTI' }, // out of window
      { accountId: 'a2', securityId: 'sVTI', date: '2026-03-01', amount: 999, type: 'buy', name: 'YOU BOUGHT VTI' }, // other acct
    ];
    const flows = classExchangeFlows(ctx, 'a1', '2026-01-01', '2026-12-31');
    const byKey = flows.reduce((m, f) => ((m[f.pathKey] = (m[f.pathKey] ?? 0) + f.amount), m), {} as Record<string, number>);
    expect(byKey['Stock']).toBe(1000);          // reinvestment + out-of-window + other-acct excluded
    expect(byKey['Stock\tUS']).toBe(1000);      // prefix accumulation
    expect(byKey['Money market']).toBe(-1000);
    expect(accountHasExchanges(ctx, 'a1', '2026-01-01', '2026-12-31')).toBe(true);
    expect(accountHasExchanges(ctx, 'a3', '2026-01-01', '2026-12-31')).toBe(false);
  });
});

describe('look-through ROI (exchanges as class flows)', () => {
  it('un-suppresses money-market ROI (~0) when its cash sweeps are captured as buy/sells', () => {
    const tags = new Map([
      ['sMM', t({ assetType: 'money_market' })],
      ['sEq', t({ assetType: 'equity', region: 'us', cap: 'large', style: 'blend' })],
    ]);
    const snaps = [
      rsnap('a1', '2025-12-31', [{ securityId: 'sMM', value: 1000 }, { securityId: 'sEq', value: 0 }]),
      rsnap('a1', '2026-07-31', [{ securityId: 'sMM', value: 1030 }, { securityId: 'sEq', value: 20 }]),
    ];
    const ctx = rangeCtx(snaps, [], tags);
    ctx.exchanges = [
      { accountId: 'a1', securityId: 'sMM', date: '2026-01-02', amount: 48, type: 'buy', name: 'PURCHASE INTO CORE ACCOUNT SPAXX' },
      { accountId: 'a1', securityId: 'sMM', date: '2026-02-02', amount: -18, type: 'sell', name: 'YOU SOLD SPAXX' },
      { accountId: 'a1', securityId: 'sEq', date: '2026-02-02', amount: 18, type: 'buy', name: 'YOU BOUGHT VTI' },
    ];
    const tree = buildAllocationWindowTree(ctx, '2026-01-01', '2026-08-07');
    const mm = tree.children.find((c) => c.label === 'Money market')!;
    expect(mm.roi.kind).toBe('ok');                       // no longer suppressed — has exchange data
    if (mm.roi.kind === 'ok') expect(mm.roi.value).toBeCloseTo(0, 1); // net flows ≈ Δ, so ~0 not −11%
  });

  it('suppresses cash-equivalent ROI when partial sweep data yields an impossible return', () => {
    // The live-app bug: a settlement "Cash" position swept from $723 down to $44
    // as cash left to settle purchases, but only an inflow (+427) was captured as
    // an exchange — the outflows never posted as sells. The captured flows don't
    // reconcile with the value change, so Modified Dietz reports −118%, a return
    // no cash instrument can have. Having *some* exchange data slips it past the
    // no-data guard, so it must be caught as unreconciled instead of displayed.
    const tags = new Map([['sCash', t({ assetType: 'cash' })]]);
    const snaps = [
      rsnap('a1', '2025-12-31', [{ securityId: 'sCash', value: 723 }]),
      rsnap('a1', '2026-07-31', [{ securityId: 'sCash', value: 44 }]),
    ];
    const ctx = rangeCtx(snaps, [], tags);
    ctx.exchanges = [
      { accountId: 'a1', securityId: 'sCash', date: '2026-04-20', amount: 427, type: 'buy', name: 'PURCHASE INTO CORE ACCOUNT' },
    ];
    const tree = buildAllocationWindowTree(ctx, '2026-01-01', '2026-08-07');
    const cash = tree.children.find((c) => c.label === 'Cash')!;
    expect(cash.roi.kind).toBe('missing'); // not a confidently-wrong −118%
  });

  it('still suppresses cash-equivalent ROI when there is no transaction data (pro-rata only)', () => {
    const tags = new Map([['sMM', t({ assetType: 'money_market' })]]);
    const snaps = [
      rsnap('a1', '2025-12-31', [{ securityId: 'sMM', value: 1000 }]),
      rsnap('a1', '2026-07-31', [{ securityId: 'sMM', value: 1500 }]),
    ];
    const tree = buildAllocationWindowTree(rangeCtx(snaps, [], tags), '2026-01-01', '2026-08-07'); // no exchanges
    const mm = tree.children.find((c) => c.label === 'Money market')!;
    expect(mm.roi.kind).toBe('missing');
  });
});
