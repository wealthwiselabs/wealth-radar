import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { buildAllocationTree } from '@/lib/investments/allocation';
import { loadAllocationContext } from '@/lib/investments/read';
import { allocationPeriod, type AllocationPeriod } from '@/lib/investments/periods';
import { schema } from '@/db/client';

const NOW = '2026-08-10T00:00:00.000Z';

/**
 * One Vanguard-shaped account: VTI (portfolio) plus VUSXX overridden to reserve.
 * Snapshots on the Feb '26 boundaries so a monthly period resolves both ends.
 */
function seedMixed(db: ReturnType<typeof makeTmpDb>['db']) {
  db.insert(schema.accounts).values({
    id: 'a1', name: 'Brokerage', institution: 'Vanguard', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
  for (const [id, ticker, assetType] of [['vti', 'VTI', 'equity'], ['vusxx', 'VUSXX', 'money_market']]) {
    db.insert(schema.securities).values({
      id, ticker, name: ticker, kind: 'mutual_fund', assetType,
      region: assetType === 'equity' ? 'us' : null, tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
    }).run();
  }
  db.insert(schema.securityPurposes).values({
    id: 'sp1', accountId: 'a1', securityId: 'vusxx', purpose: 'reserve', createdAt: NOW, modifiedAt: NOW,
  }).run();
  const snap = (id: string, asOf: string, vti: number, vusxx: number) => {
    db.insert(schema.investmentSnapshots).values({
      id, accountId: 'a1', asOf, month: asOf.slice(0, 7), source: 'statement',
      totalValue: vti + vusxx, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.snapshotHoldings).values({ id: `${id}-vti`, snapshotId: id, securityId: 'vti', quantity: null, value: vti }).run();
    db.insert(schema.snapshotHoldings).values({ id: `${id}-mm`, snapshotId: id, securityId: 'vusxx', quantity: null, value: vusxx }).run();
  };
  snap('s0', '2026-01-31', 700, 300);
  snap('s1', '2026-02-28', 770, 301);
}

const feb26 = () => allocationPeriod('monthly', 2026, 2);

describe('buildAllocationTree with target purposes', () => {
  it('defaults to portfolio and excludes reserve-overridden holdings', async () => {
    const { db } = makeTmpDb();
    seedMixed(db);
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, feb26());
    expect(root.startBalance).toBe(700);
    expect(root.balance).toBe(770);
    expect(root.children.map((c) => c.label)).toEqual(['Stock']);
  });

  it('returns only the reserve slice when targeted', async () => {
    const { db } = makeTmpDb();
    seedMixed(db);
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, feb26(), ['reserve']);
    expect(root.startBalance).toBe(300);
    expect(root.balance).toBe(301);
    expect(root.children.map((c) => c.label)).toEqual(['Money market']);
  });

  it('the two slices sum to the whole account', async () => {
    const { db } = makeTmpDb();
    seedMixed(db);
    const ctx = await loadAllocationContext(db);
    const both = buildAllocationTree(ctx, feb26(), ['portfolio', 'reserve']);
    expect(both.startBalance).toBe(1000);
    expect(both.balance).toBe(1071);
  });

  it('counts a total-only snapshot at the root but not in class buckets', async () => {
    const { db } = makeTmpDb();
    seedMixed(db);
    // A second, single-purpose account reporting a total with no holdings.
    db.insert(schema.accounts).values({
      id: 'a2', name: '401k', institution: 'Fidelity', accountClass: 'investment',
      type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
    }).run();
    for (const [id, asOf, total] of [['t0', '2026-01-31', 500], ['t1', '2026-02-28', 550]] as const) {
      db.insert(schema.investmentSnapshots).values({
        id, accountId: 'a2', asOf, month: asOf.slice(0, 7), source: 'statement',
        totalValue: total, holdingsComplete: false, note: '', createdAt: NOW, modifiedAt: NOW,
      }).run();
    }
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, feb26());
    expect(root.startBalance).toBe(1200);            // 700 classified + 500 total-only
    expect(root.balance).toBe(1320);                 // 770 + 550
    const stock = root.children.find((c) => c.label === 'Stock')!;
    expect(stock.balance).toBe(770);                 // buckets see only the holdings account
  });
});

describe('rootContrib purpose filtering (review fix)', () => {
  it('excludes a security-attributed flow whose effective purpose is not targeted', async () => {
    const { db } = makeTmpDb();
    seedMixed(db);
    // Target (VTI/portfolio) flow: counts. Excluded (VUSXX, reserve-overridden) flow: must not.
    db.insert(schema.cashFlows).values({
      id: 'f1', accountId: 'a1', securityId: 'vti', date: '2026-02-10', amount: 40,
      kind: 'contribution', source: 'manual', confirmed: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.cashFlows).values({
      id: 'f2', accountId: 'a1', securityId: 'vusxx', date: '2026-02-12', amount: 50,
      kind: 'contribution', source: 'manual', confirmed: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, feb26());
    // The $50 reserve-purpose contribution must not inflate the
    // portfolio-targeted contribution total, matching how its balance is
    // already excluded via purposeValueMulti.
    expect(root.contributions).toBe(40);
  });

  it('pro-rates an account-level flow by the target purpose share of an account close holdings', async () => {
    const { db } = makeTmpDb();
    seedMixed(db); // a1: VTI (portfolio) = 770, VUSXX (reserve) = 301 at the Feb close.
    // Account-level (no securityId) flow on the mixed a1 account: target
    // (VTI) holdings exist at close, so the whole flow counts — matching
    // how the bucket-level `contrib` loop already pro-rates an unattributed
    // flow across only the target-purpose holdings present.
    db.insert(schema.cashFlows).values({
      id: 'f1', accountId: 'a1', securityId: null, date: '2026-02-10', amount: 80,
      kind: 'contribution', source: 'manual', confirmed: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();

    // A second mixed-purpose account whose target-purpose (portfolio) slice
    // is entirely zero at the Feb close: an unattributed flow here has no
    // target holding to attribute to, so it must be excluded entirely
    // rather than defaulting to "count it all" (the pre-fix behavior).
    db.insert(schema.accounts).values({
      id: 'a3', name: 'Mixed', institution: 'Fidelity', accountClass: 'investment',
      type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
    }).run();
    for (const [id, ticker, assetType] of [['vti3', 'VTI3', 'equity'], ['vusxx3', 'VUSXX3', 'money_market']]) {
      db.insert(schema.securities).values({
        id, ticker, name: ticker, kind: 'mutual_fund', assetType,
        region: assetType === 'equity' ? 'us' : null, tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
      }).run();
    }
    db.insert(schema.securityPurposes).values({
      id: 'sp3', accountId: 'a3', securityId: 'vusxx3', purpose: 'reserve', createdAt: NOW, modifiedAt: NOW,
    }).run();
    const snap3 = (id: string, asOf: string, vti: number, vusxx: number) => {
      db.insert(schema.investmentSnapshots).values({
        id, accountId: 'a3', asOf, month: asOf.slice(0, 7), source: 'statement',
        totalValue: vti + vusxx, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
      }).run();
      db.insert(schema.snapshotHoldings).values({ id: `${id}-vti`, snapshotId: id, securityId: 'vti3', quantity: null, value: vti }).run();
      db.insert(schema.snapshotHoldings).values({ id: `${id}-mm`, snapshotId: id, securityId: 'vusxx3', quantity: null, value: vusxx }).run();
    };
    snap3('u0', '2026-01-31', 200, 300);
    snap3('u1', '2026-02-28', 0, 500); // sold all of the target-purpose slice by close
    db.insert(schema.cashFlows).values({
      id: 'f3', accountId: 'a3', securityId: null, date: '2026-02-15', amount: 100,
      kind: 'contribution', source: 'manual', confirmed: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();

    const ctx = await loadAllocationContext(db);
    const root = buildAllocationTree(ctx, feb26());
    // a1's $80 counts in full (target holdings exist); a3's $100 is excluded
    // (its target-purpose slice is $0 at close).
    expect(root.contributions).toBe(80);
  });

  it('excludes a mixed-purpose account from root and buckets alike when its carry-forward boundary snapshot is holdings-incomplete', async () => {
    const { db } = makeTmpDb();
    // A simple single-purpose account: two complete snapshots inside the window.
    db.insert(schema.accounts).values({
      id: 'a1', name: 'Brokerage', institution: 'Vanguard', accountClass: 'investment',
      type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.securities).values({
      id: 'sA', ticker: 'SA', name: 'SA', kind: 'etf', assetType: 'equity',
      region: 'us', tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
    }).run();
    const snapA = (id: string, asOf: string, value: number) => {
      db.insert(schema.investmentSnapshots).values({
        id, accountId: 'a1', asOf, month: asOf.slice(0, 7), source: 'statement',
        totalValue: value, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
      }).run();
      db.insert(schema.snapshotHoldings).values({ id: `${id}-sA`, snapshotId: id, securityId: 'sA', quantity: null, value }).run();
    };
    snapA('o1', '2026-01-10', 1000);
    snapA('c1', '2026-02-15', 1100);

    // A mixed-purpose account (VTI-shaped): its most recent snapshot on/before
    // the close boundary is total-only, so its target-purpose (portfolio)
    // value is genuinely unresolvable there — but an OLDER, holdings-complete
    // snapshot exists further back. The carry-forward "requireHoldings" pick
    // used for buckets must not be allowed to resolve independently to that
    // older snapshot once the plain pick used for root has already failed
    // to resolve the same boundary.
    db.insert(schema.accounts).values({
      id: 'a4', name: 'Mixed', institution: 'Fidelity', accountClass: 'investment',
      type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
    }).run();
    for (const [id, ticker, assetType] of [['vA4', 'VA4', 'equity'], ['vB4', 'VB4', 'money_market']]) {
      db.insert(schema.securities).values({
        id, ticker, name: ticker, kind: 'mutual_fund', assetType,
        region: assetType === 'equity' ? 'us' : null, tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
      }).run();
    }
    db.insert(schema.securityPurposes).values({
      id: 'sp4', accountId: 'a4', securityId: 'vB4', purpose: 'reserve', createdAt: NOW, modifiedAt: NOW,
    }).run();
    const snapMixed = (id: string, asOf: string, vA: number, vB: number) => {
      db.insert(schema.investmentSnapshots).values({
        id, accountId: 'a4', asOf, month: asOf.slice(0, 7), source: 'statement',
        totalValue: vA + vB, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
      }).run();
      db.insert(schema.snapshotHoldings).values({ id: `${id}-va`, snapshotId: id, securityId: 'vA4', quantity: null, value: vA }).run();
      db.insert(schema.snapshotHoldings).values({ id: `${id}-vb`, snapshotId: id, securityId: 'vB4', quantity: null, value: vB }).run();
    };
    snapMixed('m_open', '2026-01-05', 400, 100);
    snapMixed('m_stale', '2026-01-25', 420, 110); // older, holdings-complete
    // The most recent snapshot before the close boundary: total-only.
    db.insert(schema.investmentSnapshots).values({
      id: 'm_incomplete', accountId: 'a4', asOf: '2026-02-20', month: '2026-02', source: 'statement',
      totalValue: 600, holdingsComplete: false, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();

    const ctx = await loadAllocationContext(db);
    const period: AllocationPeriod = {
      key: 'range:test', label: 'test', basis: 'monthly',
      startDate: '2026-01-20', endDate: '2026-02-25', carryForward: true,
    };
    const root = buildAllocationTree(ctx, period);

    // Only a1 counts — a4 drops out of the root entirely because its close
    // value can't be resolved (total-only snapshot, mixed purpose).
    expect(root.startBalance).toBe(1000);
    expect(root.balance).toBe(1100);

    // a4 must not leak into the class breakdown via the carry-forward bucket
    // pick either — its stale $420 of VA4 must not appear anywhere.
    const stock = root.children.find((c) => c.label === 'Stock')!;
    expect(stock.balance).toBe(1100);

    // The invariant Decision 2 depends on: root can exceed the classified
    // total (a total-only account counts at the root only), but must never
    // fall short of it (buckets ⊆ root).
    const classified = root.children.reduce((s, c) => s + (c.balance ?? 0), 0);
    expect(classified).toBe(1100);
    expect(root.balance as number).toBeGreaterThanOrEqual(classified);
  });
});

describe('rootFlows pro-rata (gain/roi, not just contributions)', () => {
  it("pro-rates a mixed account's no-exchange, account-level flow by the target's share of close holdings", async () => {
    const { db } = makeTmpDb();
    seedMixed(db); // a1: VTI (portfolio) 700->770, VUSXX (reserve) 300->301 at the Feb close. No exchanges.
    // Account-level (no securityId) flow: rootFlows' fallback branch (no
    // exchanges in the window) must pro-rate this by the target's share of
    // ALL close holdings — 770 / (770 + 301) — not count it whole. This is
    // the ROI-moving path `contributions` (a yes/no rule) never exercises:
    // root.gain/root.roi come from `rootFlowSet`, computed by `rootFlows`,
    // not from `rootContrib`.
    db.insert(schema.cashFlows).values({
      id: 'f1', accountId: 'a1', securityId: null, date: '2026-02-10', amount: 100,
      kind: 'contribution', source: 'manual', confirmed: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();

    const ctx = await loadAllocationContext(db);
    expect(ctx.exchanges.filter((e) => e.accountId === 'a1')).toHaveLength(0); // no-exchanges precondition
    const root = buildAllocationTree(ctx, feb26()); // target defaults to ['portfolio']

    const share = 770 / (770 + 301);
    const proratedFlow = 100 * share;
    // root.gain = end - start - Σflows, using ONLY the portfolio-purpose slice
    // (VTI: 700 -> 770) for end/start, per Fix 1 — the reserve-purpose VUSXX
    // never enters this target's total, only the SHARE calculation does.
    expect(root.gain).toBeCloseTo(770 - 700 - proratedFlow, 6);
    expect(root.roi.kind).toBe('ok');
    if (root.roi.kind === 'ok') {
      // Modified Dietz over [700 -> 770] with a single flow of `proratedFlow`
      // roughly mid-window (Feb has 28 days; the flow lands on day 10 of 28).
      const t0 = new Date('2026-01-31T00:00:00Z').getTime();
      const t1 = new Date('2026-02-28T00:00:00Z').getTime();
      const tf = new Date('2026-02-10T00:00:00Z').getTime();
      const weight = (t1 - tf) / (t1 - t0);
      const expectedRoi = (770 - 700 - proratedFlow) / (700 + proratedFlow * weight);
      expect(root.roi.value).toBeCloseTo(expectedRoi, 4);
    }
  });
});
