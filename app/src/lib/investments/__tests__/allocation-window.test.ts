import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { buildAllocationWindowTree, nodeTrendSeries, earliestSnapshotDate } from '@/lib/investments/allocation';
import { loadAllocationContext } from '@/lib/investments/read';
import { schema } from '@/db/client';
import type { AllocContext } from '@/lib/investments/allocation';

const resolveFrom = (v: string, ctx: AllocContext) => v || earliestSnapshotDate(ctx, '2026-08-10');

const NOW = '2026-08-10T00:00:00.000Z';

function seed(db: ReturnType<typeof makeTmpDb>['db']) {
  for (const [id, name] of [['a1', 'Brokerage'], ['a2', 'IRA'], ['a3', 'Roth']] as const) {
    db.insert(schema.accounts).values({
      id, name, institution: 'Fidelity', accountClass: 'investment', type: 'investment',
      origin: 'manual', status: 'active', purpose: 'portfolio', owner: 'Alex',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
  }
  db.insert(schema.securities).values({
    id: 'vti', ticker: 'VTI', name: 'VTI', kind: 'etf', assetType: 'equity', region: 'us',
    tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
  }).run();
  const snap = (id: string, accountId: string, asOf: string, value: number) => {
    db.insert(schema.investmentSnapshots).values({
      id, accountId, asOf, month: asOf.slice(0, 7), source: 'statement',
      totalValue: value, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.snapshotHoldings).values({
      id: `${id}-h`, snapshotId: id, securityId: 'vti', quantity: null, value,
    }).run();
  };
  // a1 reports every month, plus a Dec-2025 baseline so January itself
  // resolves a boundary pair — a well-behaved period where every reporting
  // account counts and nothing is missing.
  snap('s0', 'a1', '2025-12-31', 950);
  snap('s1', 'a1', '2026-01-31', 1000);
  snap('s2', 'a1', '2026-02-28', 1100);
  snap('s3', 'a1', '2026-03-31', 1200);
  // a2 skips February entirely.
  snap('s4', 'a2', '2026-01-31', 500);
  snap('s5', 'a2', '2026-03-31', 560);
  // a3 starts reporting only in March — no Jan/Feb snapshot at all. It must
  // never show up as missing for Jan or Feb: it did not exist yet, it didn't
  // skip anything. This is the case that discriminates a correct `before &&
  // after` bracket check from a broken one that drops `before` (e.g. `if
  // (after)`), since a3's Mar-31 snapshot satisfies `after` for both Jan and
  // Feb on its own.
  snap('s6', 'a3', '2026-03-31', 300);
}

describe('buildAllocationWindowTree', () => {
  it('spans an arbitrary window with carry-forward boundaries', async () => {
    const { db } = makeTmpDb();
    seed(db);
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationWindowTree(ctx, '2026-01-31', '2026-03-31');
    expect(root.startBalance).toBe(1500);
    expect(root.balance).toBe(2060); // a3 (300) now carried forward into the balance
    expect(root.gain).toBe(260);
  });

  it('discloses accounts dropped from the root sum entirely (no on/before-start snapshot), distinct from accountsMissing', async () => {
    const { db } = makeTmpDb();
    seed(db);
    const ctx = await loadAllocationContext(db);
    // a3's only snapshot (2026-03-31) falls inside this window, but a3 has no
    // snapshot on/before the window start (2026-01-31), so it is excluded
    // from `root` entirely — not counted, and (per accountsMissingIn's
    // before&&after bracket rule) not "missing" either, since it never
    // bracketed the window. accountsInWindow must still see it: it reported
    // during the window, it's just not part of the balance above.
    const tree = buildAllocationWindowTree(ctx, '2026-01-31', '2026-03-31');
    expect(tree.accountsCounted).toBe(2); // a1, a2
    expect(tree.accountsMissing).toEqual([]);
    expect(tree.accountsInWindow).toBe(3); // a1, a2, a3
  });
});

describe('nodeTrendSeries extras', () => {
  it('carries gain and names accounts that skipped a period they bracket', async () => {
    const { db } = makeTmpDb();
    seed(db);
    const ctx = await loadAllocationContext(db);
    const points = nodeTrendSeries(ctx, [], 'monthly', '2026-01-31', '2026-03-31');

    // Well-behaved baseline (Minor from review): January resolves cleanly for
    // a1 via its Dec-2025 baseline; a2 and a3 have not reported at all as of
    // January, so neither is "missing" — accountsMissing is genuinely empty,
    // not just vacuously so, and accountsCounted matches the one account that
    // actually resolved a boundary pair.
    const jan = points.find((p) => p.periodKey === 'monthly:2026-01')!;
    expect(jan.accountsMissing).toEqual([]);
    expect(jan.accountsCounted).toBe(1);

    const feb = points.find((p) => p.periodKey === 'monthly:2026-02')!;
    expect(feb.gain).toBe(100);                       // a1 only
    expect(feb.accountsCounted).toBe(1);
    // a2 brackets February (reported Jan 31 and Mar 31) but resolves no
    // boundary pair inside it, so it IS missing. a3 has never reported as of
    // February (its only snapshot is in March) and must NOT appear here —
    // an exact-array assertion so a spurious extra entry (e.g. a3 wrongly
    // included) fails this check, not just a loose containment check.
    expect(feb.accountsMissing).toEqual(['Fidelity · IRA']);
  });
});

describe('buildAllocationWindowTree carry-forward balances', () => {
  it('includes a late-reporting account in the balance but not in ROI', async () => {
    const { db } = makeTmpDb();
    seed(db); // a3 only reports 2026-03-31 (300) — no snapshot at the window start
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationWindowTree(ctx, '2026-01-31', '2026-03-31');
    // Balance now carries a3 forward (1200 + 560 + 300); start/gain stay boundary-only.
    expect(root.balance).toBe(2060);
    expect(root.startBalance).toBe(1500);
    expect(root.gain).toBe(260);
    // ROI coverage still excludes a3 (no snapshot at the window start).
    expect(root.accountsCounted).toBe(2);
    expect(root.balanceAccounts).toBe(3);
  });

  it('surfaces an individual stock held only on a late-reporting account', async () => {
    const { db } = makeTmpDb();
    seed(db);
    db.insert(schema.accounts).values({
      id: 'ms', name: 'Brokerage', institution: 'Morgan Stanley', accountClass: 'investment',
      type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.securities).values({
      id: 'rblx', ticker: 'RBLX', name: 'Roblox', kind: 'stock', assetType: 'equity',
      region: 'us', tagSource: 'user', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.investmentSnapshots).values({
      id: 'ms1', accountId: 'ms', asOf: '2026-03-31', month: '2026-03', source: 'statement',
      totalValue: 5000, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.snapshotHoldings).values({
      id: 'ms1-h', snapshotId: 'ms1', securityId: 'rblx', quantity: null, value: 5000,
    }).run();
    const ctx = await loadAllocationContext(db);
    const root = buildAllocationWindowTree(ctx, '2026-01-31', '2026-03-31');
    const stock = root.children.find((c) => c.label === 'Stock')!;
    const indiv = stock.children.find((c) => c.label === 'Individual Stocks')!;
    expect(indiv.balance).toBe(5000);
    expect(indiv.roi.kind).toBe('missing');           // no window-start snapshot
    const rblx = indiv.children.find((c) => c.label === 'RBLX')!;
    expect(rblx.balance).toBe(5000);
  });
});

describe('window tree resolves open-ended bounds', () => {
  it('treats an empty from as the earliest snapshot and an empty to as today', async () => {
    const { db } = makeTmpDb();
    seed(db);
    const ctx = await loadAllocationContext(db);
    const earliest = ctx.snapshots.map((s) => s.asOf).sort()[0];
    const explicit = buildAllocationWindowTree(ctx, earliest, '2026-03-31');
    const resolved = buildAllocationWindowTree(ctx, resolveFrom('', ctx), '2026-03-31');
    expect(resolved.balance).toBe(explicit.balance);
    expect(resolved.startBalance).toBe(explicit.startBalance);
  });
});
