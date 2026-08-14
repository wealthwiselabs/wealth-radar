/**
 * Pure assembly for the per-account holdings/ROI/transactions breakdown section.
 * No database access: the route resolves rows and hands over plain shapes, so
 * every rule here (boundary carry-forward, window filtering, ROI, %-of-account,
 * grouping) is unit-tested over literals. The window (`from`/`to`) is injected,
 * never read from the clock, so tests are deterministic.
 */
import { modifiedDietz, type Flow, type PeriodReturn } from '@/lib/investments/returns';
import type { Purpose, PurposeOverride } from '@/lib/investments/purpose';
import type { SnapshotWithHoldings } from '@/lib/investments/snapshots';
import type { FlowRow } from '@/lib/investments/transfers';

export interface SecurityMeta {
  ticker: string | null; name: string;
  assetType: string | null; region: string | null; cap: string | null; style: string | null; sector: string | null;
  kind?: string | null;
}
export interface RawTxn {
  id: string; accountId: string; date: string; type: string; subtype: string | null; securityId: string | null; amount: number;
}
export interface BreakdownHolding extends SecurityMeta {
  securityId: string; startValue: number | null; value: number; pct: number; roi: PeriodReturn;
  /** The (account, security) purpose override, or null when the holding inherits. */
  purposeOverride: Purpose | null;
}
export interface BreakdownTxn {
  id: string; date: string; type: string; subtype: string | null; securityId: string | null; ticker: string | null; amount: number;
}
export interface AccountBreakdown {
  accountId: string; accountName: string; accountPurpose: Purpose;
  startValue: number | null; endValue: number | null; endAsOf: string | null; change: number | null;
  roi: PeriodReturn;
  holdings: BreakdownHolding[];
  transactions: BreakdownTxn[];
}

export interface AssembleInput {
  from: string;
  to: string;
  scope: string; // an account id, or 'all'
  accounts: Array<{ id: string; name: string; purpose: Purpose }>;
  overrides: PurposeOverride[];
  snapshots: SnapshotWithHoldings[];
  flows: FlowRow[];
  securities: Map<string, SecurityMeta>;
  transactions: RawTxn[];
}

export function assembleBreakdown(input: AssembleInput): AccountBreakdown[] {
  const scoped = input.scope === 'all' ? input.accounts : input.accounts.filter((a) => a.id === input.scope);

  const out: AccountBreakdown[] = [];
  for (const acct of scoped) {
    const snaps = input.snapshots
      .filter((s) => s.accountId === acct.id)
      .sort((a, b) => a.asOf.localeCompare(b.asOf));
    if (snaps.length === 0) continue; // nothing to show for an account with no history

    // When the window opens before this account's own history begins (the
    // common case under All Time, whose `from` is the GLOBAL earliest
    // snapshot across every account), anchoring at the window start finds no
    // startSnap at all and every derived figure — startValue, change, ROI —
    // goes missing for an account whose whole life fits inside the window.
    // Anchoring at the account's own first snapshot instead isn't a
    // mislabelled shorter window: when the window fully contains the
    // account's history, "since inception" and "the window return" are the
    // same figure, so this is the honest anchor, not an approximation of it.
    // A window that opens AFTER the account's first snapshot is untouched —
    // `start` still clamps to the actual requested boundary.
    const start = input.from < snaps[0].asOf ? snaps[0].asOf : input.from;

    const end = snaps[snaps.length - 1];
    const acctFlows = input.flows.filter((f) => f.accountId === acct.id);
    // Carry-forward start: the latest snapshot at or before the window start, PLUS
    // any flows that landed between that snapshot and the window start. Without the
    // adjustment a deposit after the last statement but before the window (e.g. a
    // pending transfer that settled) would be mistaken for investment gain.
    const startSnap = [...snaps].reverse().find((s) => s.asOf <= start) ?? null;
    const startValue = startSnap
      ? startSnap.totalValue + acctFlows
          .filter((f) => f.date > startSnap.asOf && f.date <= start)
          .reduce((sum, f) => sum + f.amount, 0)
      : null;
    const endValue = end.totalValue;
    const change = startValue !== null ? endValue - startValue : null;

    const windowFlows: Flow[] = acctFlows
      .filter((f) => f.date > start && f.date <= input.to)
      .map((f) => ({ date: f.date, amount: f.amount }));
    const roi: PeriodReturn = startValue === null
      ? { kind: 'missing', reason: 'no snapshot at window start' }
      : modifiedDietz(startValue, endValue, windowFlows, start, input.to);

    const total = end.totalValue || 0;
    const overrideOf = (securityId: string): Purpose | null =>
      input.overrides.find((o) => o.accountId === acct.id && o.securityId === securityId)?.purpose ?? null;
    // Value of a security in the carry-forward start snapshot (0 if not held then).
    const startHoldingValue = (securityId: string): number =>
      (startSnap?.holdings.filter((h) => h.securityId === securityId).reduce((s, h) => s + h.value, 0)) ?? 0;
    const holdings: BreakdownHolding[] = end.holdings
      .map((h) => {
        const meta = input.securities.get(h.securityId);
        // Per-position window return: Modified Dietz with this security's buy/sell
        // transactions as the flows (Plaid sign = + into the position). Missing when
        // the account has no start snapshot at all.
        const sv = startSnap ? startHoldingValue(h.securityId) : null;
        const secFlows: Flow[] = input.transactions
          .filter((t) => t.accountId === acct.id && t.securityId === h.securityId
            && (t.type === 'buy' || t.type === 'sell') && t.date >= start && t.date <= input.to)
          .map((t) => ({ date: t.date, amount: t.amount }));
        // A position not held at the window start (sv 0 or null) has no meaningful
        // range return — computing one over a near-zero base yields noise (a $2 sweep
        // reading "+67000%"). Show it as unavailable, matching the account-level rule.
        const hRoi: PeriodReturn = sv === null || sv === 0
          ? { kind: 'missing', reason: 'not held at window start' }
          : modifiedDietz(sv, h.value, secFlows, start, input.to);
        return {
          securityId: h.securityId,
          ticker: meta?.ticker ?? null,
          name: meta?.name ?? h.securityId,
          assetType: meta?.assetType ?? null, region: meta?.region ?? null,
          cap: meta?.cap ?? null, style: meta?.style ?? null, sector: meta?.sector ?? null,
          kind: meta?.kind ?? null,
          startValue: sv, value: h.value, pct: total !== 0 ? h.value / total : 0, roi: hRoi,
          purposeOverride: overrideOf(h.securityId),
        };
      })
      .sort((a, b) => b.value - a.value);

    const transactions: BreakdownTxn[] = input.transactions
      .filter((t) => t.accountId === acct.id && t.date >= start && t.date <= input.to)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((t) => ({
        id: t.id, date: t.date, type: t.type, subtype: t.subtype, securityId: t.securityId,
        ticker: t.securityId ? (input.securities.get(t.securityId)?.ticker ?? null) : null,
        amount: t.amount,
      }));

    out.push({ accountId: acct.id, accountName: acct.name, accountPurpose: acct.purpose, startValue, endValue, endAsOf: end.asOf, change, roi, holdings, transactions });
  }
  return out;
}
