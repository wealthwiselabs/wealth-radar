import { modifiedDietz, chainReturns, type PeriodReturn, type Flow } from '@/lib/investments/returns';
import {
  resolveBoundary, ALLOCATION_TOLERANCE, enumerateAllocationPeriods,
  type AllocationPeriod, type AllocationBasis,
} from '@/lib/investments/periods';
import {
  accountHoldsPurpose, holdingsForPurpose, purposeValueMulti, effectivePurpose,
  type Purpose, type PurposeOverride,
} from '@/lib/investments/purpose';
import type { SnapshotWithHoldings } from '@/lib/investments/snapshots';
import type { FlowRow } from '@/lib/investments/transfers';

export interface TagSet {
  assetType: string; region: string | null; cap: string | null; style: string | null; sector: string | null;
  kind?: string | null; ticker?: string | null; name?: string | null;
}

const CAP_LABEL: Record<string, string> = { large: 'Large Cap', mid: 'Mid Cap', small: 'Small Cap' };
const STYLE_LABEL: Record<string, string> = { value: 'Value', growth: 'Growth', blend: 'Blend' };
const SECTOR_LABEL: Record<string, string> = { technology: 'Sector: Tech', real_estate: 'Sector: REIT' };

/** The ordered node-label path a holding belongs to, given its tags. */
export function bucketPath(tags: TagSet): string[] {
  switch (tags.assetType) {
    case 'bond': return ['Bond'];
    case 'money_market': return ['Money market'];
    case 'cash': return ['Cash'];
    case 'insurance': return ['Insurance'];
    case 'equity': break;
    default: return ['Unclassified'];
  }
  // Individual stocks aggregate into their own group under Stock, keyed by
  // ticker, rather than scattering across the region/cap/style fund tree.
  if (tags.kind === 'stock') {
    return ['Stock', 'Individual Stocks', tags.ticker ?? tags.name ?? 'Unknown'];
  }
  // Equity: Region → (Sector | Cap → Style)
  const region = tags.region;
  if (region === 'intl_developed') return ['Stock', 'International', 'Developed'];
  if (region === 'intl_emerging') return ['Stock', 'International', 'Emerging'];
  if (region === 'global') return ['Stock', 'International', 'Global'];
  // us or null-region → US branch
  const path = ['Stock', 'US'];
  if (tags.sector) { path.push(SECTOR_LABEL[tags.sector] ?? `Sector: ${tags.sector}`); return path; }
  if (tags.cap && CAP_LABEL[tags.cap]) {
    path.push(CAP_LABEL[tags.cap]);
    if (tags.style && STYLE_LABEL[tags.style]) path.push(STYLE_LABEL[tags.style]);
  }
  return path;
}

/** A raw investment transaction (buy/sell/cash) — the exchange/activity stream. */
export interface ExchangeTxn {
  accountId: string; securityId: string | null; date: string; amount: number; type: string; name: string;
}
export interface AllocContext {
  snapshots: SnapshotWithHoldings[];
  accountPurposes: Map<string, Purpose>;
  overrides: PurposeOverride[];
  flows: FlowRow[];
  tagsBySecurity: Map<string, TagSet>;
  exchanges: ExchangeTxn[];
  accountLabels: Map<string, string>;
}
export interface AllocNode {
  key: string; label: string; depth: number;
  startBalance: number | null; balance: number | null; pctOfTotal: number | null;
  contributions: number | null; valueChange: number | null; gain: number | null;
  roi: PeriodReturn; fidelity?: 'chained';
  /**
   * Coverage disclosure at the root, matching AllocTrendPoint's fields below —
   * set only by buildAllocationWindowTree, since only a window query needs to
   * tell a caller "the total you got back doesn't include everyone." Undefined
   * for a plain buildAllocationTree call.
   */
  accountsCounted?: number; accountsMissing?: string[];
  /**
   * Target-purpose accounts holding ANY snapshot within [from, to], regardless
   * of root eligibility — set only by buildAllocationWindowTree, alongside
   * accountsCounted/accountsMissing. `accountsMissing` only names an account
   * that BRACKETS the window (reported before AND after) yet skipped it, so
   * an account whose whole history starts after `from` is neither counted nor
   * missing: it simply isn't in `root`. Under an All Time window, `from` is
   * the global earliest snapshot date, so this is the common case, not an
   * edge one — `accountsInWindow > accountsCounted` is how a caller tells
   * "some accounts were silently excluded from this total" from "everyone who
   * could be counted was."
   */
  accountsInWindow?: number;
  /**
   * Accounts contributing to the carry-forward BALANCE at the window end (any
   * target account with a snapshot on/before `to`). Distinct from
   * accountsCounted, which is ROI coverage (the boundary set). Set only by
   * buildAllocationWindowTree, whose balances are carry-forward while its ROI
   * stays boundary-accurate — so balanceAccounts ≥ accountsCounted.
   */
  balanceAccounts?: number;
  children: AllocNode[];
}

const UNTAGGED: TagSet = { assetType: 'other', region: null, cap: null, style: null, sector: null };
// Path-key delimiter: a tab, since node labels contain spaces ("Large Cap")
// and colons ("Sector: Tech") but never this.
const SEP = '\t';

interface Boundary { accountId: string; open: SnapshotWithHoldings; close: SnapshotWithHoldings }

/**
 * Accounts with a resolvable [open, close] pair for this period, split two ways.
 *
 * `root` needs only a value per boundary, which `purposeValueMulti` derives from
 * the reported total for any single-purpose account — so an account that reports
 * a total with no holdings still counts toward the household return. `buckets`
 * additionally requires complete holdings at both ends, because a class total
 * cannot be assembled from a snapshot that never listed its positions.
 *
 * `buckets ⊆ root`: a mixed-purpose account's value is itself unknowable without
 * complete holdings, so it can never be root-eligible while bucket-ineligible.
 * Each set carries its own window, so a total-only account extending the root
 * window cannot silently widen the flow window a class return is computed over.
 */
function boundaries(ctx: AllocContext, period: AllocationPeriod, targets: readonly Purpose[]) {
  const tol = ALLOCATION_TOLERANCE[period.basis];
  const byAccount = new Map<string, SnapshotWithHoldings[]>();
  for (const s of ctx.snapshots) {
    byAccount.set(s.accountId, [...(byAccount.get(s.accountId) ?? []), s]);
  }

  const root: Boundary[] = [];
  const buckets: Boundary[] = [];
  let rootT0 = period.endDate, rootT1 = period.startDate;
  let bucketT0 = period.endDate, bucketT1 = period.startDate;

  for (const [accountId, snaps] of byAccount) {
    const accountPurpose = ctx.accountPurposes.get(accountId) ?? 'portfolio';
    if (!accountHoldsPurpose(accountId, accountPurpose, ctx.overrides, targets)) continue;
    const sorted = [...snaps].sort((a, b) => a.asOf.localeCompare(b.asOf));

    // Trailing-range mode carries the last snapshot forward to each boundary;
    // calendar periods use nearest-within-tolerance resolution.
    const pick = (date: string, requireHoldings: boolean) => period.carryForward
      ? [...sorted].reverse().find((s) => s.asOf <= date && (!requireHoldings || s.holdingsComplete)) ?? null
      : resolveBoundary(sorted, date, tol);

    const open = pick(period.startDate, false);
    const close = pick(period.endDate, false);
    // Root eligibility gates bucket eligibility entirely (buckets ⊆ root by
    // construction): an account whose root value can't be resolved never gets
    // a chance to resolve a DIFFERENT (possibly stale, carry-forward-only)
    // pair of snapshots for its class breakdown. Without this nesting, a
    // mixed-purpose account's carry-forward `bOpen`/`bClose` picks (which
    // relax to the latest COMPLETE snapshot, ignoring a more recent
    // total-only one) could resolve independently of `open`/`close` and land
    // in `buckets` while `root` excluded it — an invariant violation.
    if (open && close && open.id !== close.id
      && purposeValueMulti(open, accountPurpose, ctx.overrides, targets) !== null
      && purposeValueMulti(close, accountPurpose, ctx.overrides, targets) !== null) {
      root.push({ accountId, open, close });
      if (open.asOf < rootT0) rootT0 = open.asOf;
      if (close.asOf > rootT1) rootT1 = close.asOf;

      const bOpen = period.carryForward ? pick(period.startDate, true) : open;
      const bClose = period.carryForward ? pick(period.endDate, true) : close;
      if (bOpen && bClose && bOpen.id !== bClose.id && bOpen.holdingsComplete && bClose.holdingsComplete) {
        buckets.push({ accountId, open: bOpen, close: bClose });
        if (bOpen.asOf < bucketT0) bucketT0 = bOpen.asOf;
        if (bClose.asOf > bucketT1) bucketT1 = bClose.asOf;
      }
    }
  }
  return { root, buckets, rootT0, rootT1, bucketT0, bucketT1 };
}

/** A reinvested dividend is return staying in the class, not a capital flow. */
function isReinvestment(name: string): boolean {
  return /reinvest/i.test(name);
}

/**
 * A security's effective purpose within an account: the per-security override
 * if one exists for (accountId, securityId), else the account's own purpose.
 * Single source of truth for the `effectivePurpose(accountPurpose, override)`
 * idiom that otherwise repeats at every flow/exchange attribution site.
 */
function securityPurpose(ctx: AllocContext, accountId: string, securityId: string | null): Purpose {
  const accountPurpose = ctx.accountPurposes.get(accountId) ?? 'portfolio';
  if (!securityId) return accountPurpose;
  return effectivePurpose(
    accountPurpose,
    ctx.overrides.find((o) => o.accountId === accountId && o.securityId === securityId)?.purpose,
  );
}

/** True if the account has any buy/sell/exchange transaction in the window. */
export function accountHasExchanges(ctx: AllocContext, accountId: string, t0: string, t1: string): boolean {
  return ctx.exchanges.some((e) => e.accountId === accountId && e.date >= t0 && e.date <= t1
    && (e.type === 'buy' || e.type === 'sell') && !isReinvestment(e.name));
}

/**
 * Look-through per-class flows for one account over [t0,t1]: each non-reinvestment
 * buy/sell (buy `+`, sell `−`, Plaid sign) emitted once per node-path prefix of its
 * security's bucketPath, so a class's Modified Dietz treats reallocations as flows
 * rather than as return. Dividends/interest (type 'cash') and reinvestments are
 * excluded — they are return, not capital movement.
 */
export function classExchangeFlows(
  ctx: AllocContext, accountId: string, t0: string, t1: string, targets: readonly Purpose[] = ['portfolio'],
): Array<{ pathKey: string; date: string; amount: number }> {
  const out: Array<{ pathKey: string; date: string; amount: number }> = [];
  for (const e of ctx.exchanges) {
    if (e.accountId !== accountId || e.date < t0 || e.date > t1) continue;
    if ((e.type !== 'buy' && e.type !== 'sell') || !e.securityId || isReinvestment(e.name)) continue;
    const p = securityPurpose(ctx, e.accountId, e.securityId);
    if (!targets.includes(p)) continue;
    const path = bucketPath(ctx.tagsBySecurity.get(e.securityId) ?? UNTAGGED);
    for (let i = 1; i <= path.length; i++) out.push({ pathKey: path.slice(0, i).join(SEP), date: e.date, amount: e.amount });
  }
  return out;
}

/** value/contrib accumulators keyed by node path (joined with SEP (a tab)). */
function accumulate(ctx: AllocContext, period: AllocationPeriod, targets: readonly Purpose[]) {
  const { root, buckets, rootT0, rootT1, bucketT0, bucketT1 } = boundaries(ctx, period, targets);
  const bucketAccountIds = new Set(buckets.map((b) => b.accountId));
  const holdingsOf = (s: SnapshotWithHoldings) =>
    holdingsForPurpose(s, ctx.accountPurposes.get(s.accountId) ?? 'portfolio', ctx.overrides, targets);

  const start = new Map<string, number>();   // path-prefix key -> start value
  const end = new Map<string, number>();
  const contrib = new Map<string, number>();
  const add = (m: Map<string, number>, path: string[], v: number) => {
    for (let i = 1; i <= path.length; i++) {
      const key = path.slice(0, i).join(SEP);
      m.set(key, (m.get(key) ?? 0) + v);
    }
  };
  for (const { open, close } of buckets) {
    for (const h of holdingsOf(open)) add(start, bucketPath(ctx.tagsBySecurity.get(h.securityId) ?? UNTAGGED), h.value);
    for (const h of holdingsOf(close)) add(end, bucketPath(ctx.tagsBySecurity.get(h.securityId) ?? UNTAGGED), h.value);
  }
  // Contributions, mapped to node paths. Only accounts with complete boundary
  // snapshots in this period may contribute — otherwise a portfolio account with a
  // confirmed flow but no in-period snapshots would double-count against the account
  // whose snapshots define the period. A flow WITH a securityId maps to that
  // security's path; an account-level flow (no securityId — e.g. a statement
  // contribution) is distributed pro-rata across the account's close holdings, so
  // the per-class contributions reconcile with the root total instead of stranding
  // the whole amount at the root.
  const closeByAccount = new Map<string, SnapshotWithHoldings>();
  for (const { close } of buckets) closeByAccount.set(close.accountId, close);
  for (const f of ctx.flows) {
    if (!bucketAccountIds.has(f.accountId)) continue;
    if (f.date < bucketT0 || f.date > bucketT1) continue;
    if (f.securityId) {
      const p = securityPurpose(ctx, f.accountId, f.securityId);
      if (!targets.includes(p)) continue;
      add(contrib, bucketPath(ctx.tagsBySecurity.get(f.securityId) ?? UNTAGGED), f.amount);
      continue;
    }
    const close = closeByAccount.get(f.accountId);
    const closeHoldings = close ? holdingsOf(close) : [];
    const closeTotal = closeHoldings.reduce((s, h) => s + h.value, 0);
    if (close && closeTotal > 0) {
      for (const h of closeHoldings) {
        add(contrib, bucketPath(ctx.tagsBySecurity.get(h.securityId) ?? UNTAGGED), f.amount * (h.value / closeTotal));
      }
    }
  }

  // ROI flows per node path (separate from the display Contributions above): an
  // account WITH transaction data uses look-through exchange flows (buy/sell) so a
  // class's Modified Dietz treats reallocations as flows, not return; an account
  // WITHOUT (legacy/statement-only) falls back to pro-rata external cash. Paths that
  // received real exchange flows are tracked so cash-equivalent ROI can be trusted.
  const roiFlowsByPath = new Map<string, Flow[]>();
  const exchangePaths = new Set<string>();
  const pushRoi = (pathKey: string, f: Flow, fromExchange: boolean) => {
    roiFlowsByPath.set(pathKey, [...(roiFlowsByPath.get(pathKey) ?? []), f]);
    if (fromExchange) exchangePaths.add(pathKey);
  };
  const addPrefixes = (fullPath: string[], f: Flow, fromExchange: boolean) => {
    for (let i = 1; i <= fullPath.length; i++) pushRoi(fullPath.slice(0, i).join(SEP), f, fromExchange);
  };
  for (const acctId of bucketAccountIds) {
    if (accountHasExchanges(ctx, acctId, bucketT0, bucketT1)) {
      for (const ef of classExchangeFlows(ctx, acctId, bucketT0, bucketT1, targets)) pushRoi(ef.pathKey, { date: ef.date, amount: ef.amount }, true);
      continue;
    }
    const close = closeByAccount.get(acctId);
    const closeHoldings = close ? holdingsOf(close) : [];
    const closeTotal = closeHoldings.reduce((s, h) => s + h.value, 0);
    for (const f of ctx.flows) {
      if (f.accountId !== acctId || f.date < bucketT0 || f.date > bucketT1) continue;
      if (f.securityId) {
        const p = securityPurpose(ctx, f.accountId, f.securityId);
        if (!targets.includes(p)) continue;
        addPrefixes(bucketPath(ctx.tagsBySecurity.get(f.securityId) ?? UNTAGGED), { date: f.date, amount: f.amount }, false);
      } else if (close && closeTotal > 0) {
        for (const h of closeHoldings) {
          addPrefixes(bucketPath(ctx.tagsBySecurity.get(h.securityId) ?? UNTAGGED), { date: f.date, amount: f.amount * (h.value / closeTotal) }, false);
        }
      }
    }
  }
  // Prefix consistency: every root-scoped field is `root*`, every bucket-scoped
  // field is `bucket*` — no bare `t0`/`t1`/`hasData` that silently means "the
  // bucket window" to a caller with no cue it isn't the root window (see the
  // file-level note on `accumulate`'s old shape). `rootHasData` lives here too
  // (not just computed ad hoc by the caller) so both non-emptiness flags are
  // available wherever the account-set/window fields are.
  return { start, end, contrib, roiFlowsByPath, exchangePaths, bucketAccountIds,
           root, rootT0, rootT1, rootHasData: root.length > 0,
           bucketT0, bucketT1, bucketHasData: buckets.length > 0 };
}

// A cash-equivalent (money market / settlement cash) cannot realistically post a
// return anywhere near this magnitude over one window — real yields are a few
// percent. A larger |ROI| means the buy/sell sweeps didn't net (partial
// transaction data: an inflow posted but the matching outflow never did, or vice
// versa), so Modified Dietz is measuring unrecorded cash movement as gain/loss,
// not return. Past this bound the figure is a data artifact (the live −118% Cash
// row), so it is suppressed as unreconciled rather than shown as fact.
const CASH_EQUIV_MAX_PLAUSIBLE_ABS_ROI = 0.5;

const TOP_ORDER = ['Stock', 'Bond', 'Money market', 'Cash', 'Insurance', 'Unclassified'];
const STOCK_ORDER = ['US', 'International', 'Individual Stocks'];
const US_ORDER = ['Large Cap', 'Mid Cap', 'Small Cap', 'Sector: Tech', 'Sector: REIT', 'Unclassified'];
const STYLE_ORDER = ['Value', 'Growth', 'Blend'];
const orderIndex = (order: string[], label: string) => { const i = order.indexOf(label); return i < 0 ? order.length : i; };

/** Numeric rank for labels not covered by a fixed order — plain lexicographic. */
function alphaRank(label: string): number {
  let n = 0;
  for (let i = 0; i < 8; i++) n = n * 256 + (label.charCodeAt(i) || 0);
  return n;
}

const CAP_LABELS = new Set(Object.values(CAP_LABEL));

/**
 * top level -> TOP_ORDER; under ['Stock','US'] -> US_ORDER; under a cap
 * (['Stock','US',<cap>]) -> STYLE_ORDER; anything else -> alphabetical.
 */
function rankSibling(parentPath: string[], label: string): number {
  if (parentPath.length === 0) return orderIndex(TOP_ORDER, label);
  if (parentPath.length === 1 && parentPath[0] === 'Stock') return orderIndex(STOCK_ORDER, label);
  if (parentPath.length === 2 && parentPath[0] === 'Stock' && parentPath[1] === 'US') {
    return orderIndex(US_ORDER, label);
  }
  if (parentPath.length === 3 && parentPath[0] === 'Stock' && parentPath[1] === 'US' && CAP_LABELS.has(parentPath[2])) {
    return orderIndex(STYLE_ORDER, label);
  }
  return alphaRank(label);
}

/** Find the descendant at `path` in an already-built tree, or undefined if absent. */
function findByPath(tree: AllocNode, path: string[]): AllocNode | undefined {
  let n: AllocNode | undefined = tree;
  for (const label of path) {
    n = n?.children.find((c) => c.label === label);
    if (!n) return undefined;
  }
  return n;
}

/**
 * The flows a root return should net out, per account.
 *
 * An account with a transaction feed for this window is read through its
 * buy/sells: a sell of A funding a buy of B cancels, leaving only money that
 * actually entered or left. That is the only basis that can distinguish an
 * external deposit from an internal sweep, which statement-derived
 * contribution/withdrawal rows cannot — see the spec's Apr '25 case. An account
 * without exchanges in the window falls back to its dated external cash flows.
 */
function rootFlows(
  ctx: AllocContext, accountBoundaries: Array<{ accountId: string; close: SnapshotWithHoldings }>,
  targets: readonly Purpose[], t0: string, t1: string,
): Flow[] {
  const out: Flow[] = [];
  for (const { accountId, close } of accountBoundaries) {
    const accountPurpose = ctx.accountPurposes.get(accountId) ?? 'portfolio';
    const purposeOf = (securityId: string | null) => securityPurpose(ctx, accountId, securityId);

    if (accountHasExchanges(ctx, accountId, t0, t1)) {
      for (const e of ctx.exchanges) {
        if (e.accountId !== accountId || e.date < t0 || e.date > t1) continue;
        if ((e.type !== 'buy' && e.type !== 'sell') || !e.securityId || isReinvestment(e.name)) continue;
        if (!targets.includes(purposeOf(e.securityId))) continue;
        out.push({ date: e.date, amount: e.amount });
      }
      continue;
    }

    const targetHoldings = holdingsForPurpose(close, accountPurpose, ctx.overrides, targets);
    const targetTotal = targetHoldings.reduce((s, h) => s + h.value, 0);
    const closeTotal = close.holdings.reduce((s, h) => s + h.value, 0);
    for (const f of ctx.flows) {
      if (f.accountId !== accountId || f.date < t0 || f.date > t1) continue;
      if (f.securityId) {
        if (targets.includes(purposeOf(f.securityId))) out.push({ date: f.date, amount: f.amount });
        continue;
      }
      // Account-level flow: whole for a single-purpose account, pro-rated by the
      // target's share of the close holdings for a mixed one.
      const share = closeTotal > 0 ? targetTotal / closeTotal : 1;
      out.push({ date: f.date, amount: f.amount * share });
    }
  }
  return out;
}

export function buildAllocationTree(
  ctx: AllocContext,
  period: AllocationPeriod,
  targets: readonly Purpose[] = ['portfolio'],
): AllocNode {
  const { start, end, contrib, roiFlowsByPath, exchangePaths,
          root, rootT0, rootT1, rootHasData, bucketT0, bucketT1, bucketHasData } = accumulate(ctx, period, targets);

  // The root's flows: per-account transaction-feed look-through where available,
  // dated external cash-flow fallback otherwise. Computed once and used for both
  // the root's ROI and its gain, so the two never disagree about what "flow" means.
  const rootFlowSet = rootFlows(ctx, root, targets, rootT0, rootT1);

  // `?? 0` here is unreachable, not a silent-zero fallback: `root` (from
  // boundaries()) only contains accounts whose purposeValueMulti already
  // resolved non-null at BOTH open and close (that's the root-eligibility
  // gate itself, above), so `pick(b)` — one of those same two snapshots —
  // can never yield null here. Absence is still never 0 in this file; this
  // is just satisfying the return type for a case that cannot occur.
  const rootValue = (pick: (b: { open: SnapshotWithHoldings; close: SnapshotWithHoldings }) => SnapshotWithHoldings) =>
    root.reduce((sum, b) => sum + (purposeValueMulti(
      pick(b), ctx.accountPurposes.get(b.accountId) ?? 'portfolio', ctx.overrides, targets) ?? 0), 0);
  const rootStart = rootValue((b) => b.open);
  const rootEnd = root.length > 0 ? rootValue((b) => b.close) : null;
  // The root's contribution is EVERY in-period confirmed target-purpose-account
  // cash flow, with or without a securityId — unlike sub-nodes (which only see
  // security-attributed flows via `contrib`), the root aggregates all of them
  // since account-level flows have no security to walk a bucketPath from.
  // Restricted to accounts in the root set (their own window, rootT0/rootT1) —
  // otherwise an account with a flow but no in-period snapshots would
  // double-count against the account whose snapshots actually define the period.
  //
  // A flow is still purpose-filtered like every other contribution/ROI path:
  // a securityId-attributed flow counts only when that security's effective
  // purpose is in `targets` (a deposit into a reserve-overridden fund must
  // not inflate a portfolio-targeted contribution total, matching how its
  // balance is already excluded via purposeValueMulti above). An
  // account-level flow (no securityId) can't be attributed to one security,
  // so it's pro-rated across the account's target-purpose close holdings —
  // the same computation the bucket-level `contrib` loop below already does
  // (distributing the full flow across only the target holdings present),
  // collapsed to a single yes/no here since root has no sub-classes to split
  // across: the full amount counts if any target holding exists at close,
  // zero if the account's target-purpose slice is empty there. A
  // single-purpose account (no per-security overrides) skips the holdings
  // lookup entirely — its root eligibility already establishes whether its
  // whole balance is in `targets`.
  const rootByAccount = new Map(root.map((b) => [b.accountId, b]));
  const rootContrib = ctx.flows.reduce((sum, f) => {
    const b = rootByAccount.get(f.accountId);
    if (!b || f.date < rootT0 || f.date > rootT1) return sum;
    const accountPurpose = ctx.accountPurposes.get(f.accountId) ?? 'portfolio';
    if (f.securityId) {
      const p = securityPurpose(ctx, f.accountId, f.securityId);
      return targets.includes(p) ? sum + f.amount : sum;
    }
    // "Has overrides" for this purpose-filtering decision means an override that
    // actually changes the account's effective purpose for some holding — an
    // override row whose purpose matches the account default is a no-op and
    // must not force the more expensive holdings-based path below (matches
    // purposeValue's own `mine` filter in purpose.ts).
    const hasOverrides = ctx.overrides.some((o) => o.accountId === f.accountId && o.purpose !== accountPurpose);
    if (!hasOverrides) {
      return targets.includes(accountPurpose) ? sum + f.amount : sum;
    }
    const closeHoldings = holdingsForPurpose(b.close, accountPurpose, ctx.overrides, targets);
    const closeTotal = closeHoldings.reduce((s, h) => s + h.value, 0);
    return closeTotal > 0 ? sum + f.amount : sum;
  }, 0);

  // A yearly period carries its four quarters. Build each quarter's tree once so
  // every node's ROI can chain the quarterly ROIs at the same path — balance,
  // %, value change, and contributions still come from the year's own
  // start/end (computed above via accumulate over [period.startDate, period.endDate],
  // exactly as the single-period path).
  const quarterTrees = period.subPeriods?.map((sp) => buildAllocationTree(ctx, sp, targets));

  // The root may exceed the sum of its top-level classes (a total-only account
  // counts at the root but has no bucket to classify into) — so `pctOfTotal`
  // for sub-nodes is relative to the classified total, not the root, or
  // sibling percentages would no longer sum to 100%.
  const classifiedEnd = [...end.entries()].filter(([k]) => !k.includes(SEP)).reduce((s, [, v]) => s + v, 0);

  // Immediate children of a path prefix, discovered from the accumulator keys.
  // For a yearly period, also union in labels discovered by each quarter tree at
  // the same path — the year's own boundary snapshot (e.g. a true Dec 31 reading)
  // may not exist at all even though every quarter has data, and a node must
  // still surface so its chained ROI is reachable.
  const childrenOf = (prefix: string[]): string[] => {
    const set = new Set<string>();
    const pk = prefix.join(SEP);
    const depth = prefix.length;
    for (const key of new Set([...start.keys(), ...end.keys()])) {
      const parts = key.split(SEP);
      if (parts.length === depth + 1 && (depth === 0 || key.startsWith(pk + SEP))) set.add(parts[depth]);
    }
    if (quarterTrees) {
      for (const qt of quarterTrees) {
        for (const label of findByPath(qt, prefix)?.children.map((c) => c.label) ?? []) set.add(label);
      }
    }
    return [...set];
  };

  // The root's own window differs from the bucket window (Decision 2): its
  // balances come from the root set, so its own Modified Dietz uses rootT0/T1
  // (rootHasData/bucketHasData/bucketT0/bucketT1 all come from accumulate()).

  const makeNode = (path: string[]): AllocNode => {
    const key = path.join(SEP);
    const isRoot = path.length === 0;
    const s = isRoot ? rootStart : (start.get(key) ?? 0);
    const e = isRoot ? rootEnd : (bucketHasData ? (end.get(key) ?? 0) : null);
    const c = isRoot ? rootContrib : (contrib.get(key) ?? 0);
    // ROI uses look-through flows for sub-nodes (dated buy/sells or pro-rata cash);
    // the root uses rootFlowSet — per-account transaction-feed look-through where
    // available, dated external cash-flow fallback otherwise (see rootFlows above).
    const flows: Flow[] = isRoot ? rootFlowSet : (roiFlowsByPath.get(key) ?? []);
    const flowTotal = flows.reduce((sum, f) => sum + f.amount, 0);
    let roi: PeriodReturn;
    let fidelity: 'chained' | undefined;
    // A chained node's gain must come from the same sub-periods that produced its
    // chained roi — the year's own rootFlowSet/flows is an independent computation
    // (a different flow basis, possibly a different account set) and would let the
    // dollar figure disagree with the percentage beside it. Sum the quarters' gains
    // instead, all-or-nothing like chainReturns: one missing quarter gain -> null.
    let chainedGain: number | null | undefined;
    if (quarterTrees) {
      const okQuarterROIs = quarterTrees
        .map((qt) => findByPath(qt, path)?.roi)
        .filter((r): r is Extract<PeriodReturn, { kind: 'ok' }> => r?.kind === 'ok');
      roi = okQuarterROIs.length > 0
        ? chainReturns(okQuarterROIs)
        : { kind: 'missing', reason: 'no quarter has an ok ROI for this node' };
      fidelity = 'chained';
      const quarterGains = quarterTrees.map((qt) => findByPath(qt, path)?.gain ?? null);
      chainedGain = quarterGains.some((g) => g === null)
        ? null
        : quarterGains.reduce<number>((sum, g) => sum + (g as number), 0);
    } else if (isRoot) {
      roi = !rootHasData
        ? { kind: 'missing', reason: 'no complete-holdings snapshot in period' }
        : modifiedDietz(s, e as number, flows, rootT0, rootT1);
    } else {
      roi = !bucketHasData
        ? { kind: 'missing', reason: 'no complete-holdings snapshot in period' }
        : modifiedDietz(s, e as number, flows, bucketT0, bucketT1);
    }
    // Cash-equivalents (money market, cash): a Modified-Dietz "return" is only
    // meaningful when the buy/sell exchanges net out the cash sweeps. Two ways
    // that fails, both suppressed to the tile's — rather than shown as fact:
    //   1. No transaction data for the class at all (pro-rata only) — nothing to
    //      net the sweeps against.
    //   2. Partial transaction data that doesn't reconcile: enough exchange rows
    //      to clear guard (1), but the captured flows disagree with the value
    //      change badly enough to push |ROI| past what a cash instrument can
    //      actually return. That's unrecorded sweeps, not a real gain/loss.
    if (path[0] === 'Money market' || path[0] === 'Cash') {
      if (!exchangePaths.has(key)) {
        roi = { kind: 'missing', reason: 'cash-equivalent — no transaction data to net cash sweeps' };
      } else if (roi.kind === 'ok' && Math.abs(roi.value) > CASH_EQUIV_MAX_PLAUSIBLE_ABS_ROI) {
        roi = { kind: 'missing', reason: 'cash-equivalent — sweep transactions don’t reconcile with the value change' };
      }
    }
    const kids = childrenOf(path)
      .map((label) => makeNode([...path, label]))
      .sort((a, b) => rankSibling(path, a.label) - rankSibling(path, b.label));
    return {
      key: key || 'root', label: path[path.length - 1] ?? 'Portfolio', depth: path.length,
      startBalance: e === null ? null : s,
      balance: e, valueChange: e === null ? null : e - s,
      contributions: c, pctOfTotal: isRoot ? (rootEnd === null ? null : 1) : (e === null || !classifiedEnd ? null : e / classifiedEnd),
      gain: quarterTrees ? (chainedGain as number | null) : (e === null ? null : e - s - flowTotal),
      roi, fidelity, children: kids,
    };
  };
  return makeNode([]);
}

/** Earliest snapshot date, or `fallback` when there are no snapshots at all. */
export function earliestSnapshotDate(ctx: AllocContext, fallback: string): string {
  return ctx.snapshots.length ? [...ctx.snapshots].map((s) => s.asOf).sort()[0] : fallback;
}

/**
 * Allocation tree over an explicit [from, to] window, carrying the last snapshot
 * forward to each boundary. One Modified Dietz over the whole window — not a
 * chain — so a single missing month cannot blank the result.
 */
export function buildAllocationWindowTree(
  ctx: AllocContext, from: string, to: string, targets: readonly Purpose[] = ['portfolio'],
): AllocNode {
  const period: AllocationPeriod = {
    key: `window:${from}:${to}`, label: `${from}–${to}`, basis: 'monthly',
    startDate: from, endDate: to, carryForward: true,
  };
  // Boundary tree — the source of truth for startBalance / valueChange /
  // contributions / roi / gain / fidelity. Its account set is those with a
  // resolvable [open, close] pair, which drops any account lacking a snapshot at
  // the window start (a newly-connected brokerage, an individually held stock).
  const boundaryTree = buildAllocationTree(ctx, period, targets);

  // Carry-forward balances at the window END: every account with holdings
  // on/before `to`, regardless of a window-start snapshot. Only balance and % use
  // these — period metrics stay on the boundary tree, so a carry-forward-only
  // node reads its real balance with an honest "—" for ROI/Δ. This is what
  // surfaces individual stocks (Stock → Individual Stocks → <ticker>) and other
  // August-first accounts the boundary tree omits. Reuses the same helpers the
  // trend chart's value lines already draw, so the snapshot and the trend agree.
  const hh = householdValueAt(ctx, to, targets);
  const cf = allocationValueAt(ctx, to, targets);
  const classifiedEnd = [...cf.entries()].filter(([k]) => !k.includes(SEP)).reduce((s, [, v]) => s + v, 0);

  const childrenOf = (prefix: string[]): string[] => {
    const set = new Set<string>();
    const pk = prefix.join(SEP);
    const depth = prefix.length;
    for (const key of cf.keys()) {
      const parts = key.split(SEP);
      if (parts.length === depth + 1 && (depth === 0 || key.startsWith(pk + SEP))) set.add(parts[depth]);
    }
    // A node the boundary tree has but carry-forward doesn't (e.g. a total-only
    // account classified at its open) must still appear.
    for (const c of findByPath(boundaryTree, prefix)?.children ?? []) set.add(c.label);
    return [...set];
  };

  const makeNode = (path: string[]): AllocNode => {
    const key = path.join(SEP);
    const isRoot = path.length === 0;
    const b = findByPath(boundaryTree, path);
    const balance = isRoot ? hh : (cf.get(key) ?? b?.balance ?? 0);
    const children = childrenOf(path)
      .map((label) => makeNode([...path, label]))
      .sort((x, y) => rankSibling(path, x.label) - rankSibling(path, y.label));
    return {
      key: key || 'root', label: path[path.length - 1] ?? 'Portfolio', depth: path.length,
      startBalance: b?.startBalance ?? null,
      balance,
      valueChange: b?.valueChange ?? null,
      contributions: b?.contributions ?? null,
      pctOfTotal: isRoot
        ? (hh === null ? null : 1)
        : (balance === null || !classifiedEnd ? null : balance / classifiedEnd),
      gain: b?.gain ?? null,
      roi: b?.roi ?? { kind: 'missing', reason: 'no snapshot at window start' },
      fidelity: b?.fidelity,
      children,
    };
  };

  const tree = makeNode([]);

  // Coverage: ROI coverage (accountsCounted / accountsMissing) is the boundary
  // set; balance coverage (balanceAccounts) is every target account with a
  // snapshot on/before `to`. accountsInWindow (any snapshot within [from,to]) is
  // retained for existing callers.
  const counted = new Set(rootAccountIds(ctx, period, targets));
  tree.accountsCounted = counted.size;
  tree.accountsMissing = accountsMissingIn(ctx, period, targets, counted);
  tree.accountsInWindow = accountsInWindowIds(ctx, from, to, targets).size;
  const balanceAccts = new Set<string>();
  for (const s of ctx.snapshots) {
    const p = ctx.accountPurposes.get(s.accountId) ?? 'portfolio';
    if (accountHoldsPurpose(s.accountId, p, ctx.overrides, targets) && s.asOf <= to) balanceAccts.add(s.accountId);
  }
  tree.balanceAccounts = balanceAccts.size;
  return tree;
}

export interface AllocTrendPoint {
  periodKey: string; label: string;
  /** The period's end-date month (YYYY-MM), for joining against monthly spending totals by month key. */
  month: string;
  /**
   * The period's start date (YYYY-MM-DD). Callers that need to drop periods
   * which haven't begun yet (e.g. trailing months under a This-Year window)
   * must filter on this, not `month` — `month` is the period's *end*, so for
   * quarterly/yearly bases it can already be in the future while the period
   * itself is still in progress (Q3 2026 carries month "2026-09" but starts
   * "2026-07-01"). Only startDate answers "has this period begun."
   */
  startDate: string;
  value: number | null; roi: number | null;
  gain: number | null; accountsCounted: number; accountsMissing: string[];
}

/**
 * Target-purpose accounts that bracket this period — reporting on/before its
 * start and on/after its end — yet resolve no boundary pair within it. An
 * account that has never reported is not missing; it did not exist yet.
 */
function accountsMissingIn(
  ctx: AllocContext, period: AllocationPeriod, targets: readonly Purpose[], counted: Set<string>,
): string[] {
  const out: string[] = [];
  const byAccount = new Map<string, SnapshotWithHoldings[]>();
  for (const s of ctx.snapshots) byAccount.set(s.accountId, [...(byAccount.get(s.accountId) ?? []), s]);
  for (const [accountId, snaps] of byAccount) {
    if (counted.has(accountId)) continue;
    const p = ctx.accountPurposes.get(accountId) ?? 'portfolio';
    if (!accountHoldsPurpose(accountId, p, ctx.overrides, targets)) continue;
    const before = snaps.some((s) => s.asOf <= period.startDate);
    const after = snaps.some((s) => s.asOf >= period.endDate);
    if (before && after) out.push(ctx.accountLabels.get(accountId) ?? accountId);
  }
  return out.sort();
}

/** The root-eligible account ids for a period — accounts with a resolvable [open, close] pair. */
export function rootAccountIds(
  ctx: AllocContext, period: AllocationPeriod, targets: readonly Purpose[] = ['portfolio'],
): string[] {
  return boundaries(ctx, period, targets).root.map((b) => b.accountId);
}

/**
 * Target-purpose accounts holding any snapshot within [from, to] — a coarser,
 * cheaper question than root eligibility (no boundary-pair resolution, no
 * carry-forward/tolerance rules). Answers "how many accounts do we know were
 * part of the household during this window," independent of whether each one
 * resolved a usable [open, close] pair for it.
 */
function accountsInWindowIds(
  ctx: AllocContext, from: string, to: string, targets: readonly Purpose[],
): Set<string> {
  const byAccount = new Map<string, SnapshotWithHoldings[]>();
  for (const s of ctx.snapshots) byAccount.set(s.accountId, [...(byAccount.get(s.accountId) ?? []), s]);
  const out = new Set<string>();
  for (const [accountId, snaps] of byAccount) {
    const p = ctx.accountPurposes.get(accountId) ?? 'portfolio';
    if (!accountHoldsPurpose(accountId, p, ctx.overrides, targets)) continue;
    if (snaps.some((s) => s.asOf >= from && s.asOf <= to)) out.add(accountId);
  }
  return out;
}

/** A node's balance and ROI across every period in [from, to] at the given basis. */
/**
 * Household portfolio value carried forward to `asOf`: sum each portfolio
 * account's latest snapshot on/before that date. A balance persists until the
 * account next reports, so the total is drawable on every period even when a
 * month lacks a statement (combined Fidelity statements, etc.) — null only
 * before the first snapshot exists.
 */
export function householdValueAt(
  ctx: AllocContext, asOf: string, targets: readonly Purpose[] = ['portfolio'],
): number | null {
  const latest = new Map<string, SnapshotWithHoldings>();
  for (const s of ctx.snapshots) {
    const p = ctx.accountPurposes.get(s.accountId) ?? 'portfolio';
    if (!accountHoldsPurpose(s.accountId, p, ctx.overrides, targets)) continue;
    if (s.asOf > asOf) continue;
    const cur = latest.get(s.accountId);
    if (!cur || s.asOf > cur.asOf) latest.set(s.accountId, s);
  }
  if (latest.size === 0) return null;
  let total = 0;
  for (const s of latest.values()) {
    const v = purposeValueMulti(s, ctx.accountPurposes.get(s.accountId) ?? 'portfolio', ctx.overrides, targets);
    // Absence is never 0 (the file's central invariant): a mixed-purpose
    // account whose latest-as-of-`asOf` snapshot lacks complete holdings
    // makes the target-purpose split genuinely unknowable, not zero. Summing
    // only the resolvable accounts and quietly dropping this one would render
    // a total that LOOKS complete but is short by this account's whole value
    // — worse than showing nothing, per series.ts's valueAt/purposeReturnBetween
    // ("a total that silently drops an account is worse than no total at
    // all"). So the whole household total goes unknown (null) rather than
    // guessing: this is the ROOT-level rule (see allocationValueAt below for
    // the different rule that wins at the bucket level, and why).
    if (v === null) return null;
    total += v;
  }
  return total;
}

/**
 * Carry-forward allocation value per node-path at `asOf`: for each portfolio
 * account, take its latest holdings-complete snapshot on/before the date and
 * bucket its holdings into node paths (with prefix accumulation, like
 * accumulate()). Lets sub-node trend lines (Stock/Bond/…) draw continuously
 * across months an account didn't report, instead of only where a full
 * boundary pair exists. Returns path-key → summed value.
 *
 * Deliberately a DIFFERENT rule from householdValueAt's for "the latest
 * snapshot is incomplete": householdValueAt refuses to guess and returns a
 * single overall `null` (a mixed-purpose account can't be classified at all
 * without holdings, so honesty wins at the root, where "unknown" has
 * somewhere to go). This function has no such place to put an "unknown" —
 * its output is a bag of per-path sums with no slot for "this path's
 * contribution from this account is unresolvable," and dropping the whole
 * map for one account's hiccup would blank every class line whenever ANY
 * account reports an incomplete snapshot, defeating the carry-forward
 * continuity this function exists for. So here CONTINUITY wins instead:
 * an incomplete snapshot is skipped in the search for "latest," same as if
 * it didn't exist, letting an older complete snapshot's breakdown carry
 * forward. The root total (via householdValueAt, rendered on the same
 * trend) is what tells the user something is uncertain; the sub-node lines
 * intentionally keep drawing through it rather than all going blank too.
 */
export function allocationValueAt(
  ctx: AllocContext, asOf: string, targets: readonly Purpose[] = ['portfolio'],
): Map<string, number> {
  const latest = new Map<string, SnapshotWithHoldings>();
  for (const s of ctx.snapshots) {
    const p = ctx.accountPurposes.get(s.accountId) ?? 'portfolio';
    if (!accountHoldsPurpose(s.accountId, p, ctx.overrides, targets)) continue;
    if (s.asOf > asOf || !s.holdingsComplete) continue; // need holdings to bucket
    const cur = latest.get(s.accountId);
    if (!cur || s.asOf > cur.asOf) latest.set(s.accountId, s);
  }
  const m = new Map<string, number>();
  const add = (path: string[], v: number) => {
    for (let i = 1; i <= path.length; i++) {
      const key = path.slice(0, i).join(SEP);
      m.set(key, (m.get(key) ?? 0) + v);
    }
  };
  for (const s of latest.values()) {
    const holdings = holdingsForPurpose(s, ctx.accountPurposes.get(s.accountId) ?? 'portfolio', ctx.overrides, targets);
    for (const h of holdings) add(bucketPath(ctx.tagsBySecurity.get(h.securityId) ?? UNTAGGED), h.value);
  }
  return m;
}

export function nodeTrendSeries(
  ctx: AllocContext, path: string[], basis: AllocationBasis, from: string, to: string,
  targets: readonly Purpose[] = ['portfolio'],
): AllocTrendPoint[] {
  return enumerateAllocationPeriods(from, to, basis).map((period) => {
    const root = buildAllocationTree(ctx, period, targets);
    const node = findByPath(root, path);
    // VALUE is carry-forward so every line is continuous from its first snapshot
    // (root = true household total incl. total-only accounts; sub-nodes = carried
    // bucketed holdings). ROI stays period/boundary based (honest gaps).
    const value = path.length === 0
      ? householdValueAt(ctx, period.endDate, targets)
      : (allocationValueAt(ctx, period.endDate, targets).get(path.join(SEP)) ?? null);
    const counted = new Set(rootAccountIds(ctx, period, targets));
    return {
      periodKey: period.key, label: period.label, month: period.endDate.slice(0, 7),
      startDate: period.startDate, value,
      roi: node?.roi.kind === 'ok' ? node.roi.value : null,
      gain: node?.gain ?? null,
      accountsCounted: counted.size,
      accountsMissing: accountsMissingIn(ctx, period, targets, counted),
    };
  });
}
