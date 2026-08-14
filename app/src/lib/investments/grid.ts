import {
  generatePeriods, resolveBoundary, MONTHLY_TOLERANCE_DAYS, QUARTERLY_TOLERANCE_DAYS,
  type Period, type PeriodBasis,
} from '@/lib/investments/periods';
import { modifiedDietz, chainReturns, type PeriodReturn, type Flow } from '@/lib/investments/returns';
import { netInterAccountTransfers, type FlowRow } from '@/lib/investments/transfers';
import {
  purposeValue, effectivePurpose, accountHoldsPurpose, type Purpose, type PurposeOverride,
} from '@/lib/investments/purpose';
import type { SnapshotWithHoldings } from '@/lib/investments/snapshots';

export interface GridCell {
  return: PeriodReturn; fidelity?: 'chained' | 'single';
  /** Display labels of purpose-target accounts excluded from this cell for
   *  lacking a boundary snapshot. Household cells only; empty/absent when the
   *  cell covers the full target set. */
  excluded?: string[];
}
export interface GridRow {
  kind: 'household' | 'account' | 'class';
  id: string; label: string; owner?: string; cells: GridCell[];
}
export interface ReturnsGrid { periods: Period[]; rows: GridRow[] }

export interface GridAccount {
  id: string; institution: string; name: string; owner: string; purpose: Purpose;
}
export interface GridContext {
  snapshots: SnapshotWithHoldings[];
  accountPurposes: Map<string, Purpose>;
  overrides: PurposeOverride[];
  flows: FlowRow[];
  accounts: GridAccount[];
  assetTypeBySecurity: Map<string, string>;
}
export interface GridOptions { basis: PeriodBasis; from: string; to: string; target: Purpose }

const ASSET_CLASS_ORDER = ['equity', 'bond', 'money_market', 'cash', 'insurance', 'other'];
const ASSET_CLASS_LABEL: Record<string, string> = {
  equity: 'Equity', bond: 'Bond', money_market: 'Money market',
  cash: 'Cash', insurance: 'Insurance', other: 'Unclassified',
};

function tolerance(basis: PeriodBasis): number {
  return basis === 'quarterly' ? QUARTERLY_TOLERANCE_DAYS : MONTHLY_TOLERANCE_DAYS;
}

function toFlows(rows: FlowRow[]): Flow[] {
  return rows.map((f) => ({ date: f.date, amount: f.amount }));
}

/** One account's snapshots, ascending. */
function snapsOf(snapshots: SnapshotWithHoldings[], accountId: string): SnapshotWithHoldings[] {
  return snapshots.filter((s) => s.accountId === accountId).sort((a, b) => a.asOf.localeCompare(b.asOf));
}

// ---- account cell -------------------------------------------------------

/** Single day-weighted Dietz for one account over one [open,close] boundary pair. */
function accountSingle(
  accountSnaps: SnapshotWithHoldings[], accountPurpose: Purpose, overrides: PurposeOverride[],
  target: Purpose, accountFlows: FlowRow[], period: Period,
): PeriodReturn {
  const tol = tolerance(period.basis);
  const open = resolveBoundary(accountSnaps, period.openDate, tol);
  const close = resolveBoundary(accountSnaps, period.closeDate, tol);
  if (!open) return { kind: 'missing', reason: 'no snapshot at period start' };
  if (!close) return { kind: 'missing', reason: 'no snapshot at period end' };
  if (open.id === close.id) return { kind: 'missing', reason: 'only one capture in period' };
  const v0 = purposeValue(open, accountPurpose, overrides, target);
  const v1 = purposeValue(close, accountPurpose, overrides, target);
  if (v0 === null || v1 === null) return { kind: 'missing', reason: 'holdings incomplete' };
  return modifiedDietz(v0, v1, toFlows(accountFlows), open.asOf, close.asOf);
}

export function computeAccountCell(
  accountSnaps: SnapshotWithHoldings[], accountPurpose: Purpose, overrides: PurposeOverride[],
  target: Purpose, accountFlows: FlowRow[], period: Period,
): GridCell {
  if (period.basis === 'monthly' || !period.months) {
    return { return: accountSingle(accountSnaps, accountPurpose, overrides, target, accountFlows, period) };
  }
  const monthly = period.months.map((m) =>
    accountSingle(accountSnaps, accountPurpose, overrides, target, accountFlows, m));
  if (monthly.every((r) => r.kind === 'ok')) {
    return { return: chainReturns(monthly), fidelity: 'chained' };
  }
  const fallback = accountSingle(accountSnaps, accountPurpose, overrides, target, accountFlows, period);
  return fallback.kind === 'ok' ? { return: fallback, fidelity: 'single' } : { return: fallback };
}

// ---- household cell -----------------------------------------------------

function accountsForTarget(ctx: GridContext, target: Purpose): string[] {
  const ids = new Set<string>();
  for (const s of ctx.snapshots) {
    const p = ctx.accountPurposes.get(s.accountId) ?? 'portfolio';
    if (accountHoldsPurpose(s.accountId, p, ctx.overrides, [target])) ids.add(s.accountId);
  }
  return [...ids].sort();
}

/** Purpose-target account ids that resolve a snapshot at BOTH of `period`'s own boundaries. */
function resolvedAccountIds(ctx: GridContext, target: Purpose, period: Period): string[] {
  const tol = tolerance(period.basis);
  const ids = accountsForTarget(ctx, target);
  const resolved: string[] = [];
  for (const id of ids) {
    const s = snapsOf(ctx.snapshots, id);
    const open = resolveBoundary(s, period.openDate, tol);
    const close = resolveBoundary(s, period.closeDate, tol);
    if (!open || !close || open.id === close.id) continue;
    resolved.push(id);
  }
  return resolved;
}

function accountLabel(ctx: GridContext, id: string): string {
  const a = ctx.accounts.find((acc) => acc.id === id);
  return a ? `${a.institution} · ${a.name}` : id;
}

/**
 * Labels of purpose-target accounts NOT resolved at `period`'s own [open,close]
 * boundaries — i.e. dropped from this cell for lacking a boundary snapshot.
 * Empty when the cell covers the full target set (nothing to disclose).
 */
function excludedLabels(ctx: GridContext, target: Purpose, period: Period): string[] {
  const targetIds = accountsForTarget(ctx, target);
  const resolved = new Set(resolvedAccountIds(ctx, target, period));
  return targetIds
    .filter((id) => !resolved.has(id))
    .map((id) => accountLabel(ctx, id))
    .sort();
}

function householdSingle(ctx: GridContext, target: Purpose, period: Period): PeriodReturn {
  const tol = tolerance(period.basis);
  const ids = accountsForTarget(ctx, target);
  let v0 = 0, v1 = 0;
  let t0 = period.closeDate, t1 = period.openDate;   // will shrink/grow to actual dates
  const included: string[] = [];
  for (const id of ids) {
    const s = snapsOf(ctx.snapshots, id);
    const open = resolveBoundary(s, period.openDate, tol);
    const close = resolveBoundary(s, period.closeDate, tol);
    if (!open || !close || open.id === close.id) continue;
    const a0 = purposeValue(open, ctx.accountPurposes.get(id) ?? 'portfolio', ctx.overrides, target);
    const a1 = purposeValue(close, ctx.accountPurposes.get(id) ?? 'portfolio', ctx.overrides, target);
    if (a0 === null || a1 === null) continue;
    v0 += a0; v1 += a1; included.push(id);
    if (open.asOf < t0) t0 = open.asOf;
    if (close.asOf > t1) t1 = close.asOf;
  }
  if (included.length === 0) return { kind: 'missing', reason: 'no account snapshotted at both ends' };
  const relevantFlows = ctx.flows.filter((f) => included.includes(f.accountId));
  const external = netInterAccountTransfers(relevantFlows);
  return modifiedDietz(v0, v1, toFlows(external), t0, t1);
}

export function computeHouseholdCell(ctx: GridContext, target: Purpose, period: Period): GridCell {
  if (period.basis === 'monthly' || !period.months) {
    const r = householdSingle(ctx, target, period);
    if (r.kind !== 'ok') return { return: r };
    const excluded = excludedLabels(ctx, target, period);
    return excluded.length ? { return: r, excluded } : { return: r };
  }
  const monthly = period.months.map((m) => householdSingle(ctx, target, m));
  if (monthly.every((r) => r.kind === 'ok')) {
    // Excluded set is disclosed at the quarter's OWN boundaries, not per-month —
    // a household that fully chains is still worth flagging if the quarter's
    // own endpoints don't cover every target account.
    const excluded = excludedLabels(ctx, target, period);
    return excluded.length
      ? { return: chainReturns(monthly), fidelity: 'chained', excluded }
      : { return: chainReturns(monthly), fidelity: 'chained' };
  }
  const fallback = householdSingle(ctx, target, period);
  if (fallback.kind !== 'ok') return { return: fallback };
  const excluded = excludedLabels(ctx, target, period);
  return excluded.length
    ? { return: fallback, fidelity: 'single', excluded }
    : { return: fallback, fidelity: 'single' };
}

// ---- class cell (gross value return, labeled) ---------------------------

/** Sum of a snapshot's holdings whose security is `assetType` and effective purpose is `target`. */
function classValue(
  ctx: GridContext, snapshot: SnapshotWithHoldings, accountPurpose: Purpose,
  target: Purpose, assetType: string,
): number {
  const byOverride = new Map(
    ctx.overrides.filter((o) => o.accountId === snapshot.accountId).map((o) => [o.securityId, o.purpose]));
  return snapshot.holdings.reduce((sum, h) => {
    if ((ctx.assetTypeBySecurity.get(h.securityId) ?? 'other') !== assetType) return sum;
    const p = effectivePurpose(accountPurpose, byOverride.get(h.securityId));
    return p === target ? sum + h.value : sum;
  }, 0);
}

function classSingle(ctx: GridContext, target: Purpose, assetType: string, period: Period): PeriodReturn {
  const tol = tolerance(period.basis);
  const ids = accountsForTarget(ctx, target);
  let v0 = 0, v1 = 0, included = 0;
  for (const id of ids) {
    const s = snapsOf(ctx.snapshots, id);
    const open = resolveBoundary(s, period.openDate, tol);
    const close = resolveBoundary(s, period.closeDate, tol);
    // A class total needs complete holdings at BOTH ends, over a fixed account set.
    if (!open || !close || open.id === close.id) continue;
    if (!open.holdingsComplete || !close.holdingsComplete) {
      return { kind: 'missing', reason: 'holdings incomplete for class total' };
    }
    const p = ctx.accountPurposes.get(id) ?? 'portfolio';
    v0 += classValue(ctx, open, p, target, assetType);
    v1 += classValue(ctx, close, p, target, assetType);
    included++;
  }
  if (included === 0) return { kind: 'missing', reason: 'no complete-holdings snapshot for this class' };
  // No flow term: contributions and reallocations are not attributable at class grain.
  return modifiedDietz(v0, v1, [], period.openDate, period.closeDate);
}

export function computeClassCell(ctx: GridContext, target: Purpose, assetType: string, period: Period): GridCell {
  if (period.basis === 'monthly' || !period.months) {
    return { return: classSingle(ctx, target, assetType, period) };
  }
  const monthly = period.months.map((m) => classSingle(ctx, target, assetType, m));
  if (monthly.every((r) => r.kind === 'ok')) {
    return { return: chainReturns(monthly), fidelity: 'chained' };
  }
  const fallback = classSingle(ctx, target, assetType, period);
  return fallback.kind === 'ok' ? { return: fallback, fidelity: 'single' } : { return: fallback };
}

// ---- assembly -----------------------------------------------------------

function assetClassesPresent(ctx: GridContext, target: Purpose): string[] {
  const present = new Set<string>();
  const ids = new Set(accountsForTarget(ctx, target));
  for (const s of ctx.snapshots) {
    if (!ids.has(s.accountId)) continue;
    for (const h of s.holdings) present.add(ctx.assetTypeBySecurity.get(h.securityId) ?? 'other');
  }
  return ASSET_CLASS_ORDER.filter((c) => present.has(c));
}

export function buildReturnsGrid(ctx: GridContext, opts: GridOptions): ReturnsGrid {
  const periods = generatePeriods(opts.from, opts.to, opts.basis);
  const targetIds = new Set(accountsForTarget(ctx, opts.target));
  const targetAccounts = ctx.accounts
    .filter((a) => targetIds.has(a.id))
    .sort((a, b) => (a.owner + a.institution + a.name).localeCompare(b.owner + b.institution + b.name));

  const rows: GridRow[] = [];

  rows.push({
    kind: 'household', id: 'household', label: 'Household total',
    cells: periods.map((p) => computeHouseholdCell(ctx, opts.target, p)),
  });

  for (const a of targetAccounts) {
    const accountSnaps = snapsOf(ctx.snapshots, a.id);
    const accountFlows = ctx.flows.filter((f) => f.accountId === a.id);
    rows.push({
      kind: 'account', id: a.id, label: `${a.institution} · ${a.name}`, owner: a.owner,
      cells: periods.map((p) =>
        computeAccountCell(accountSnaps, a.purpose, ctx.overrides, opts.target, accountFlows, p)),
    });
  }

  for (const cls of assetClassesPresent(ctx, opts.target)) {
    rows.push({
      kind: 'class', id: cls, label: ASSET_CLASS_LABEL[cls] ?? cls,
      cells: periods.map((p) => computeClassCell(ctx, opts.target, cls, p)),
    });
  }

  return { periods, rows };
}
