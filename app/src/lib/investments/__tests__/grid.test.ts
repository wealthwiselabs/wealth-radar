import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { importLegacyQuarters, type LegacyClassRow } from '@/lib/investments/legacyImport';
import { loadGridContext } from '@/lib/investments/read';
import {
  computeAccountCell, computeHouseholdCell, computeClassCell, buildReturnsGrid,
  type GridContext,
} from '@/lib/investments/grid';
import { generatePeriods } from '@/lib/investments/periods';
import type { SnapshotWithHoldings } from '@/lib/investments/snapshots';
import type { Purpose } from '@/lib/investments/purpose';
import type { FlowRow } from '@/lib/investments/transfers';
import { accounts } from '@/db/schema';

const NOW = '2026-08-03T00:00:00.000Z';

function snap(accountId: string, asOf: string, totalValue: number,
  holdings: SnapshotWithHoldings['holdings'] = [], holdingsComplete = false): SnapshotWithHoldings {
  return { id: `${accountId}-${asOf}`, accountId, asOf, month: asOf.slice(0, 7),
    source: 'paste', totalValue, holdingsComplete, holdings };
}

const monthly = (label: string) => generatePeriods('2026-01-01', '2026-12-31', 'monthly')
  .find((p) => p.label === label)!;

const quarterly = (label: string) => generatePeriods('2026-01-01', '2026-12-31', 'quarterly')
  .find((p) => p.label === label)!;

describe('computeAccountCell', () => {
  it('day-weights a mid-period flow, un-netted at account grain', () => {
    const snaps = [snap('a1', '2026-05-31', 1000), snap('a1', '2026-06-30', 1200)];
    const flows: FlowRow[] = [{ id: 'f', accountId: 'a1', date: '2026-06-15', amount: 100, kind: 'contribution' }];
    const cell = computeAccountCell(snaps, 'portfolio', [], 'portfolio', flows, monthly("Jun '26"));
    expect(cell.return.kind).toBe('ok');
    // (1200 - 1000 - 100) / (1000 + 100*w), w = daysBetween(06-15,06-30)/daysBetween(05-31,06-30)
    if (cell.return.kind === 'ok') expect(cell.return.value).toBeGreaterThan(0.09);
  });

  it('is missing (never 0) when a boundary snapshot is absent', () => {
    const snaps = [snap('a1', '2026-06-30', 1200)];   // no May boundary
    const cell = computeAccountCell(snaps, 'portfolio', [], 'portfolio', [], monthly("Jun '26"));
    expect(cell.return.kind).toBe('missing');
  });
});

describe('computeHouseholdCell', () => {
  it('nets an inter-account transfer out of the household flow term', () => {
    const snaps = [
      snap('a1', '2026-05-31', 1000), snap('a2', '2026-05-31', 1000),
      snap('a1', '2026-06-30', 500), snap('a2', '2026-06-30', 1600),
    ];
    const ctx: GridContext = {
      snapshots: snaps,
      accountPurposes: new Map([['a1', 'portfolio'], ['a2', 'portfolio']]),
      overrides: [],
      flows: [
        { id: 'o', accountId: 'a1', date: '2026-06-10', amount: -500, kind: 'transfer_out' },
        { id: 'i', accountId: 'a2', date: '2026-06-13', amount: 500, kind: 'transfer_in' },
      ],
      accounts: [], assetTypeBySecurity: new Map(),
    };
    const cell = computeHouseholdCell(ctx, 'portfolio', monthly("Jun '26"));
    expect(cell.return.kind).toBe('ok');
    if (cell.return.kind === 'ok') expect(cell.return.value).toBeCloseTo(0.05, 6);
  });

  it('is missing (never 0) when no account qualifies at both boundaries', () => {
    // Only one portfolio account, and it has a snapshot near the close boundary
    // but nothing near the open boundary — no account can resolve both ends.
    const snaps = [snap('a1', '2026-06-30', 1200)];
    const ctx: GridContext = {
      snapshots: snaps,
      accountPurposes: new Map([['a1', 'portfolio']]),
      overrides: [],
      flows: [],
      accounts: [], assetTypeBySecurity: new Map(),
    };
    const cell = computeHouseholdCell(ctx, 'portfolio', monthly("Jun '26"));
    expect(cell.return.kind).toBe('missing');
  });

  describe('partial-coverage transfer (Finding 1 adjudication)', () => {
    // A is captured at both boundaries; B is captured only at the open boundary
    // and is dropped from this cell. A confirmed A->B transfer moves $50k out
    // of A right at the open boundary (Dietz weight ~= 1). Market is flat, so
    // A's true value change is entirely explained by the outflow: the measured
    // set {A} truly returned 0% — the $50k left the measured set as an external
    // outflow, not a loss. It must NOT be netted away just because its partner
    // (B) happens to also be a portfolio account; B isn't part of THIS cell's
    // measured value, so from this cell's perspective the transfer is external.
    const period = monthly("Jun '26"); // open 2026-05-31, close 2026-06-30
    const ctx: GridContext = {
      snapshots: [
        snap('a', '2026-05-31', 1000000),
        snap('a', '2026-06-30', 950000),
        snap('b', '2026-05-31', 500000),   // B: no close-boundary snapshot -> dropped
      ],
      accountPurposes: new Map([['a', 'portfolio'], ['b', 'portfolio']]),
      overrides: [],
      flows: [
        { id: 'a-out', accountId: 'a', date: '2026-05-31', amount: -50000, kind: 'transfer_out' },
        { id: 'b-in', accountId: 'b', date: '2026-05-31', amount: 50000, kind: 'transfer_in' },
      ],
      accounts: [
        { id: 'a', institution: 'Vanguard', name: 'Brokerage', owner: 'Alex', purpose: 'portfolio' },
        { id: 'b', institution: 'Fidelity', name: '401k', owner: 'Alex', purpose: 'portfolio' },
      ],
      assetTypeBySecurity: new Map(),
    };

    it('treats the transfer to a dropped partner as external, not netted away (0% return)', () => {
      const cell = computeHouseholdCell(ctx, 'portfolio', period);
      expect(cell.return.kind).toBe('ok');
      if (cell.return.kind === 'ok') expect(cell.return.value).toBeCloseTo(0, 6);
    });

    it('names the excluded account (B) in the cell for tooltip disclosure', () => {
      const cell = computeHouseholdCell(ctx, 'portfolio', period);
      expect(cell.excluded).toContain('Fidelity · 401k');
    });
  });
});

describe('computeClassCell', () => {
  it('is a gross value return with no flow term, over complete-holdings accounts', () => {
    const eq = { securityId: 'eqSec', quantity: null, value: 0 };
    const ctx: GridContext = {
      snapshots: [
        snap('a1', '2026-05-31', 1000, [{ ...eq, value: 1000 }], true),
        snap('a1', '2026-06-30', 1100, [{ ...eq, value: 1100 }], true),
      ],
      accountPurposes: new Map([['a1', 'portfolio']]),
      overrides: [],
      flows: [{ id: 'f', accountId: 'a1', date: '2026-06-15', amount: 200, kind: 'contribution' }],
      accounts: [], assetTypeBySecurity: new Map([['eqSec', 'equity']]),
    };
    const cell = computeClassCell(ctx, 'portfolio', 'equity', monthly("Jun '26"));
    expect(cell.return.kind).toBe('ok');
    // Gross: (1100-1000)/1000 = 0.10, contribution NOT removed.
    if (cell.return.kind === 'ok') expect(cell.return.value).toBeCloseTo(0.10, 6);
  });

  it('is missing when a contributing account has incomplete holdings at a boundary', () => {
    const eq = { securityId: 'eqSec', quantity: null, value: 1000 };
    const ctx: GridContext = {
      snapshots: [
        snap('a1', '2026-05-31', 1000, [eq], false),   // incomplete
        snap('a1', '2026-06-30', 1100, [{ ...eq, value: 1100 }], true),
      ],
      accountPurposes: new Map([['a1', 'portfolio']]), overrides: [],
      flows: [], accounts: [], assetTypeBySecurity: new Map([['eqSec', 'equity']]),
    };
    const cell = computeClassCell(ctx, 'portfolio', 'equity', monthly("Jun '26"));
    expect(cell.return.kind).toBe('missing');
  });
});

describe('quarterly chained fidelity', () => {
  // 2026 Q2 = Apr/May/Jun, boundaries at 2026-03-31, 04-30, 05-31, 06-30.
  // Each month grows 10%: 1000 -> 1100 -> 1210 -> 1331. Chained = 1.1^3 - 1 = 0.331.
  const q2Snaps = (accountId: string) => [
    snap(accountId, '2026-03-31', 1000),
    snap(accountId, '2026-04-30', 1100),
    snap(accountId, '2026-05-31', 1210),
    snap(accountId, '2026-06-30', 1331),
  ];

  it('chains three resolved monthly sub-returns at account grain', () => {
    const cell = computeAccountCell(q2Snaps('a1'), 'portfolio', [], 'portfolio', [], quarterly('2026 Q2'));
    expect(cell.return.kind).toBe('ok');
    expect(cell.fidelity).toBe('chained');
    if (cell.return.kind === 'ok') expect(cell.return.value).toBeCloseTo(0.331, 6);
  });

  it('chains three resolved monthly sub-returns at household grain', () => {
    const ctx: GridContext = {
      snapshots: q2Snaps('a1'),
      accountPurposes: new Map([['a1', 'portfolio']]),
      overrides: [],
      flows: [],
      accounts: [], assetTypeBySecurity: new Map(),
    };
    const cell = computeHouseholdCell(ctx, 'portfolio', quarterly('2026 Q2'));
    expect(cell.return.kind).toBe('ok');
    expect(cell.fidelity).toBe('chained');
    if (cell.return.kind === 'ok') expect(cell.return.value).toBeCloseTo(0.331, 6);
  });
});

describe('fidelity is absent (not "single") on a missing quarterly fallback', () => {
  it('leaves fidelity undefined when the quarterly single-Dietz fallback is also missing', () => {
    // No snapshots at all: monthly sub-returns are all missing, and the
    // whole-quarter single-Dietz fallback is missing too.
    const cell = computeAccountCell([], 'portfolio', [], 'portfolio', [], quarterly('2026 Q1'));
    expect(cell.return.kind).toBe('missing');
    expect(cell.fidelity).toBeUndefined();
  });
});

describe('buildReturnsGrid golden anchor', () => {
  it('reproduces the sheet 2025 Q1 household return (-0.1285) as a single-fidelity quarterly cell', async () => {
    const { db } = makeTmpDb();
    db.insert(accounts).values({
      id: 'hh', name: 'Household', institution: 'Legacy', accountClass: 'investment',
      type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    const HOUSEHOLD: LegacyClassRow[] = [{
      className: 'Total US Index',
      quarters: [
        { label: '2025 Q1', start: '2025-01-01', end: '2025-03-31', startValue: 1675448.11, endValue: 1480273.34, contributions: 23100.09 },
      ],
    }];
    await importLegacyQuarters('hh', HOUSEHOLD, db);

    const ctx = await loadGridContext(db);
    const grid = buildReturnsGrid(ctx, { basis: 'quarterly', from: '2025-01-01', to: '2025-03-31', target: 'portfolio' });

    const household = grid.rows.find((r) => r.kind === 'household')!;
    const q1 = grid.periods.findIndex((p) => p.label === '2025 Q1');
    const cell = household.cells[q1];
    expect(cell.return.kind).toBe('ok');
    if (cell.return.kind === 'ok') expect(cell.return.value).toBeCloseTo(-0.1285, 4);
    expect(cell.fidelity).toBe('single');   // no monthly captures -> single-Dietz fallback

    // The equity class row is a GROSS value return over the same quarter and
    // deliberately differs (contributions not removed).
    const equity = grid.rows.find((r) => r.kind === 'class' && r.id === 'equity')!;
    const classCell = equity.cells[q1];
    expect(classCell.return.kind).toBe('ok');
    if (classCell.return.kind === 'ok') expect(classCell.return.value).toBeCloseTo(-0.11649, 4);
  });
});
