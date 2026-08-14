import { describe, it, expect } from 'vitest';
import { assembleBreakdown, type SecurityMeta } from '@/lib/investments/breakdown';
import type { SnapshotWithHoldings } from '@/lib/investments/snapshots';

const NOW = '2026-08-07';
// Equivalent to the old rangeStart(NOW, '3m') / ('6m'), kept as literals now that
// the trailing-range keyword is gone and callers pass an explicit window.
const START_3M = '2026-05-07';
const START_6M = '2026-02-07';

function snap(over: Partial<SnapshotWithHoldings> & { accountId: string; asOf: string; totalValue: number }): SnapshotWithHoldings {
  return {
    id: `${over.accountId}-${over.asOf}`, accountId: over.accountId, asOf: over.asOf,
    month: over.asOf.slice(0, 7), source: over.source ?? 'statement', totalValue: over.totalValue,
    holdingsComplete: true, holdings: over.holdings ?? [],
  };
}
const secs = new Map<string, SecurityMeta>([
  ['sVTI', { ticker: 'VTI', name: 'Vanguard Total Market', assetType: 'equity', region: 'us', cap: 'large', style: 'blend', sector: null }],
  ['sBND', { ticker: 'BND', name: 'Vanguard Total Bond', assetType: 'bond', region: null, cap: null, style: null, sector: null }],
]);

describe('assembleBreakdown', () => {
  const base = {
    from: START_3M, to: NOW,
    accounts: [{ id: 'a1', name: 'Brokerage', purpose: 'portfolio' as const }, { id: 'a2', name: 'IRA', purpose: 'portfolio' as const }],
    overrides: [],
    flows: [], transactions: [], securities: secs,
  };

  it('resolves start (carry-forward at/before window start) and end (latest) values', () => {
    const snapshots = [
      snap({ accountId: 'a1', asOf: '2026-03-31', totalValue: 900 }),  // before window start (2026-05-07) → carry-forward start
      snap({ accountId: 'a1', asOf: '2026-06-30', totalValue: 1000 }),
      snap({ accountId: 'a1', asOf: '2026-07-31', totalValue: 1100 }), // latest → end
    ];
    const [r] = assembleBreakdown({ ...base, scope: 'a1', snapshots });
    expect(r.startValue).toBe(900);
    expect(r.endValue).toBe(1100);
    expect(r.endAsOf).toBe('2026-07-31');
    expect(r.change).toBe(200);
    expect(r.roi).toEqual({ kind: 'ok', value: (1100 - 900) / 900 }); // no flows
  });

  it('folds flows between the last snapshot and the window start into the start value (no phantom gain)', () => {
    const snapshots = [
      snap({ accountId: 'a1', asOf: '2026-01-31', totalValue: 50000 }),
      snap({ accountId: 'a1', asOf: '2026-07-31', totalValue: 98000 }),
    ];
    // A deposit after the Jan-31 snapshot but before the 6m-equivalent window start (2026-02-07).
    const flows = [{ id: 'dep', accountId: 'a1', date: '2026-02-02', amount: 48000, kind: 'contribution', securityId: null }];
    const [r] = assembleBreakdown({ ...base, from: START_6M, scope: 'a1', snapshots, flows });
    expect(r.startValue).toBe(98000);            // 50000 carried + 48000 settled before the window
    expect(r.change).toBe(0);
    expect(r.roi).toEqual({ kind: 'ok', value: 0 }); // not a fabricated 96% gain
  });

  it("a from equal to the first snapshot anchors since-inception (the caller's 'all' window)", () => {
    const snapshots = [
      snap({ accountId: 'a1', asOf: '2025-01-31', totalValue: 1000 }),
      snap({ accountId: 'a1', asOf: '2026-07-31', totalValue: 1500 }),
    ];
    const [r] = assembleBreakdown({ ...base, from: '2025-01-31', scope: 'a1', snapshots });
    expect(r.startValue).toBe(1000);
    expect(r.endValue).toBe(1500);
    expect(r.roi).toEqual({ kind: 'ok', value: 0.5 });
  });

  it('clamps the anchor to the sole snapshot when the account has no history at/before the window start, instead of going missing', () => {
    // The account's only reading (2026-07-31) postdates the window start
    // (START_3M = 2026-05-07) — its whole history is inside the window, so
    // the anchor clamps forward to that one snapshot rather than reporting
    // "no start value." With only one reading, start and end are the same
    // number, so change/ROI are a computable flat 0%, not an absence.
    const snapshots = [snap({ accountId: 'a1', asOf: '2026-07-31', totalValue: 1100 })];
    const [r] = assembleBreakdown({ ...base, scope: 'a1', snapshots });
    expect(r.startValue).toBe(1100);
    expect(r.change).toBe(0);
    expect(r.roi).toEqual({ kind: 'ok', value: 0 });
  });

  it('computes %-of-account holdings from the latest snapshot, sorted by value desc', () => {
    const snapshots = [snap({ accountId: 'a1', asOf: '2026-07-31', totalValue: 1000,
      holdings: [{ securityId: 'sBND', quantity: 1, value: 250 }, { securityId: 'sVTI', quantity: 2, value: 750 }] })];
    const [r] = assembleBreakdown({ ...base, scope: 'a1', snapshots });
    expect(r.holdings.map((h) => [h.ticker, h.value, h.pct])).toEqual([['VTI', 750, 0.75], ['BND', 250, 0.25]]);
    expect(r.holdings[0]).toMatchObject({ assetType: 'equity', region: 'us', cap: 'large', style: 'blend' });
  });

  it('computes per-holding start value and window ROI', () => {
    const snapshots = [
      snap({ accountId: 'a1', asOf: '2026-04-30', totalValue: 900, holdings: [{ securityId: 'sVTI', quantity: 1, value: 900 }] }),
      snap({ accountId: 'a1', asOf: '2026-07-31', totalValue: 1200, holdings: [{ securityId: 'sVTI', quantity: 1, value: 1200 }] }),
    ];
    // window start 2026-05-07 -> start snapshot is 2026-04-30 (VTI = 900). No buy/sell.
    const [r] = assembleBreakdown({ ...base, scope: 'a1', snapshots });
    const vti = r.holdings[0];
    expect(vti.startValue).toBe(900);
    expect(vti.roi).toEqual({ kind: 'ok', value: (1200 - 900) / 900 });
  });

  it('treats a per-holding buy as a position flow (not gain) in the ROI', () => {
    const snapshots = [
      snap({ accountId: 'a1', asOf: '2026-04-30', totalValue: 1000, holdings: [{ securityId: 'sVTI', quantity: 1, value: 1000 }] }),
      snap({ accountId: 'a1', asOf: '2026-07-31', totalValue: 2100, holdings: [{ securityId: 'sVTI', quantity: 2, value: 2100 }] }),
    ];
    // Held 1000 at the window start; a +1000 buy at the start; ended 2100 -> the extra 100
    // is return, NOT the whole +1100. ROI = (2100-1000-1000)/(1000+1000·1) = 100/2000 = 5%.
    const transactions = [{ id: 'b', accountId: 'a1', date: '2026-05-07', type: 'buy', subtype: 'buy', securityId: 'sVTI', amount: 1000 }];
    const [r] = assembleBreakdown({ ...base, scope: 'a1', snapshots, transactions });
    const vti = r.holdings.find((h) => h.securityId === 'sVTI')!;
    expect(vti.startValue).toBe(1000);
    expect(vti.roi.kind).toBe('ok');
    if (vti.roi.kind === 'ok') expect(vti.roi.value).toBeCloseTo(0.05, 4);
  });

  it('marks a per-holding ROI unavailable when the security was not held at the window start', () => {
    const snapshots = [
      snap({ accountId: 'a1', asOf: '2026-04-30', totalValue: 500, holdings: [{ securityId: 'sBND', quantity: 1, value: 500 }] }),
      snap({ accountId: 'a1', asOf: '2026-07-31', totalValue: 502, holdings: [{ securityId: 'sBND', quantity: 1, value: 500 }, { securityId: 'sVTI', quantity: 1, value: 2 }] }),
    ];
    const [r] = assembleBreakdown({ ...base, scope: 'a1', snapshots });
    const vti = r.holdings.find((h) => h.securityId === 'sVTI')!;
    expect(vti.startValue).toBe(0);
    expect(vti.roi.kind).toBe('missing'); // no absurd "+67000%" on a tiny new sweep position
  });

  it('includes only window flows in ROI and window transactions (newest first)', () => {
    const snapshots = [
      snap({ accountId: 'a1', asOf: '2026-04-30', totalValue: 1000 }),
      snap({ accountId: 'a1', asOf: '2026-07-31', totalValue: 1200 }),
    ];
    const flows = [
      { id: 'f-old', accountId: 'a1', date: '2026-01-10', amount: 500, kind: 'contribution', securityId: null }, // out of window
      { id: 'f-in', accountId: 'a1', date: '2026-06-01', amount: 100, kind: 'contribution', securityId: null },   // in window
    ];
    const transactions = [
      { id: 't-old', accountId: 'a1', date: '2026-02-01', type: 'cash', subtype: 'contribution', securityId: null, amount: -500 },
      { id: 't-in1', accountId: 'a1', date: '2026-06-01', type: 'cash', subtype: 'contribution', securityId: null, amount: -100 },
      { id: 't-in2', accountId: 'a1', date: '2026-07-15', type: 'buy', subtype: 'buy', securityId: 'sVTI', amount: 100 },
    ];
    const [r] = assembleBreakdown({ ...base, scope: 'a1', snapshots, flows, transactions });
    expect(r.transactions.map((t) => t.id)).toEqual(['t-in2', 't-in1']); // newest first, out-of-window dropped
    expect(r.transactions[0].ticker).toBe('VTI');
    // ROI base only counts the in-window flow (+100), weighted by dietz.
    expect(r.roi.kind).toBe('ok');
  });

  it('scope "all" returns one entry per account WITH snapshots; specific id returns just that one', () => {
    const snapshots = [
      snap({ accountId: 'a1', asOf: '2026-07-31', totalValue: 1000 }),
      // a2 has no snapshots → excluded under "all"
    ];
    expect(assembleBreakdown({ ...base, scope: 'all', snapshots }).map((r) => r.accountId)).toEqual(['a1']);
    expect(assembleBreakdown({ ...base, scope: 'a1', snapshots }).map((r) => r.accountId)).toEqual(['a1']);
    expect(assembleBreakdown({ ...base, scope: 'a2', snapshots })).toEqual([]);
  });
});

import type { PurposeOverride } from '@/lib/investments/purpose';

describe('assembleBreakdown purpose fields', () => {
  it('reports the account purpose and each holding’s override', () => {
    const overrides: PurposeOverride[] = [{ accountId: 'a1', securityId: 'vusxx', purpose: 'reserve' }];
    const [entry] = assembleBreakdown({
      from: '2026-01-01', to: '2026-04-30', scope: 'a1',
      accounts: [{ id: 'a1', name: 'Vanguard · Brokerage', purpose: 'portfolio' }],
      overrides,
      snapshots: [{
        id: 's1', accountId: 'a1', asOf: '2026-04-30', month: '2026-04', source: 'statement',
        totalValue: 1000, holdingsComplete: true,
        holdings: [
          { securityId: 'vti', quantity: null, value: 700 },
          { securityId: 'vusxx', quantity: null, value: 300 },
        ],
      }],
      flows: [], transactions: [],
      securities: new Map([
        ['vti', { ticker: 'VTI', name: 'VTI', assetType: 'equity', region: 'us', cap: null, style: null, sector: null }],
        ['vusxx', { ticker: 'VUSXX', name: 'VUSXX', assetType: 'money_market', region: null, cap: null, style: null, sector: null }],
      ]),
    });
    expect(entry.accountPurpose).toBe('portfolio');
    expect(entry.holdings.find((h) => h.securityId === 'vusxx')!.purposeOverride).toBe('reserve');
    expect(entry.holdings.find((h) => h.securityId === 'vti')!.purposeOverride).toBeNull();
  });
});

describe('assembleBreakdown over an explicit window', () => {
  const snaps = [
    { id: 's0', accountId: 'a1', asOf: '2026-01-31', month: '2026-01', source: 'statement',
      totalValue: 1000, holdingsComplete: true, holdings: [{ securityId: 'vti', quantity: null, value: 1000 }] },
    { id: 's1', accountId: 'a1', asOf: '2026-04-30', month: '2026-04', source: 'statement',
      totalValue: 1200, holdingsComplete: true, holdings: [{ securityId: 'vti', quantity: null, value: 1200 }] },
  ];
  const securities = new Map([['vti', { ticker: 'VTI', name: 'VTI', assetType: 'equity', region: 'us', cap: null, style: null, sector: null }]]);

  it('anchors the start at the window start, not at a trailing month count', () => {
    const [entry] = assembleBreakdown({
      from: '2026-01-31', to: '2026-04-30', scope: 'a1',
      accounts: [{ id: 'a1', name: 'Vanguard · Brokerage', purpose: 'portfolio' }],
      overrides: [], snapshots: snaps, flows: [], transactions: [], securities,
    });
    expect(entry.startValue).toBe(1000);
    expect(entry.endValue).toBe(1200);
    expect(entry.change).toBe(200);
  });

  it('keeps the window start as the anchor when the account already existed before it', () => {
    // a1's history predates the window (a Nov-2025 snapshot before the
    // 2026-01-31 window start) — the anchor must stay at the window start,
    // not slide back to the account's actual first snapshot.
    const withEarlierHistory = [
      { id: 's-1', accountId: 'a1', asOf: '2025-11-30', month: '2025-11', source: 'statement',
        totalValue: 800, holdingsComplete: true, holdings: [{ securityId: 'vti', quantity: null, value: 800 }] },
      ...snaps,
    ];
    const [entry] = assembleBreakdown({
      from: '2026-01-31', to: '2026-04-30', scope: 'a1',
      accounts: [{ id: 'a1', name: 'Vanguard · Brokerage', purpose: 'portfolio' }],
      overrides: [], snapshots: withEarlierHistory, flows: [], transactions: [], securities,
    });
    expect(entry.startValue).toBe(1000); // the window-start snapshot, not the earlier 800
    expect(entry.change).toBe(200);
  });

  it("clamps the anchor to the account's first snapshot when the window opens before its history begins, making ROI computable instead of missing", () => {
    // The window (2025-01-01) opens well before a1's history (2026-01-31) —
    // the common shape under All Time, whose `from` is the global earliest
    // snapshot across every account, not this one's own.
    const [entry] = assembleBreakdown({
      from: '2025-01-01', to: '2026-04-30', scope: 'a1',
      accounts: [{ id: 'a1', name: 'Vanguard · Brokerage', purpose: 'portfolio' }],
      overrides: [], snapshots: snaps, flows: [], transactions: [], securities,
    });
    expect(entry.startValue).toBe(1000); // anchored at the account's own first snapshot
    expect(entry.change).toBe(200);
    expect(entry.roi).toEqual({ kind: 'ok', value: 0.2 }); // (1200-1000)/1000, not missing
  });
});

describe('assembleBreakdown security kind', () => {
  it('surfaces the security kind on each holding', () => {
    const securities = new Map<string, SecurityMeta>([
      ['sRBLX', { ticker: 'RBLX', name: 'Roblox', assetType: 'equity', region: 'us', cap: 'mid', style: 'growth', sector: null, kind: 'stock' }],
    ]);
    const r = assembleBreakdown({
      from: '2026-01-01', to: '2026-03-01', scope: 'all',
      accounts: [{ id: 'a1', name: 'MS', purpose: 'portfolio' }],
      overrides: [], flows: [], transactions: [], securities,
      snapshots: [
        { id: 'o', accountId: 'a1', asOf: '2026-01-31', month: '2026-01', source: 'paste', totalValue: 900, holdingsComplete: true, holdings: [{ securityId: 'sRBLX', quantity: 1, value: 900 }] },
        { id: 'c', accountId: 'a1', asOf: '2026-02-28', month: '2026-02', source: 'paste', totalValue: 1000, holdingsComplete: true, holdings: [{ securityId: 'sRBLX', quantity: 1, value: 1000 }] },
      ],
    })[0];
    expect(r.holdings[0].kind).toBe('stock');
  });
});
