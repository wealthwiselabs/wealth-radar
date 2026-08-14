import { modifiedDietz, chainReturns, type PeriodReturn, type Flow } from '@/lib/investments/returns';
import { purposeValue, accountHoldsPurpose, type Purpose, type PurposeOverride } from '@/lib/investments/purpose';
import { netInterAccountTransfers, type FlowRow } from '@/lib/investments/transfers';
import type { SnapshotWithHoldings } from '@/lib/investments/snapshots';

export interface PurposePoint {
  asOf: string;
  value: number;
  accountsCounted: number;
  /** Accounts of this purpose that have snapshots elsewhere but not on this date. */
  accountsMissing: string[];
}

function accountsWithPurpose(
  snapshots: SnapshotWithHoldings[],
  accountPurposes: Map<string, Purpose>,
  overrides: PurposeOverride[],
  target: Purpose,
): string[] {
  const ids = new Set<string>();
  for (const s of snapshots) {
    const accountPurpose = accountPurposes.get(s.accountId) ?? 'portfolio';
    if (accountHoldsPurpose(s.accountId, accountPurpose, overrides, [target])) ids.add(s.accountId);
  }
  return [...ids].sort();
}

/**
 * One point per date on which an account relevant to `target` reported, each
 * summing every relevant account's *latest value as of that date*.
 *
 * A balance carries forward: an account snapshotted in June still holds that
 * value in July until it reports again, so the total is the household's real
 * balance rather than a partial dip. This is what lets a multi-account line
 * draw continuously even when accounts are captured on different dates — the
 * common case, and the one that previously left the line undrawable.
 *
 * `accountsMissing` therefore means only "has not reported *yet* as of this
 * date" (i.e. before the account's first-ever snapshot). By the last date every
 * relevant account has reported, so the trailing point — the one a summary tile
 * reads — is always the full total.
 *
 * Dates where no relevant account reported at all are skipped entirely: they
 * are not in the union of relevant snapshot dates. Snapshotting only the
 * insurance account is not an event in the portfolio's history.
 */
export function buildValueSeries(
  snapshots: SnapshotWithHoldings[],
  accountPurposes: Map<string, Purpose>,
  overrides: PurposeOverride[],
  target: Purpose,
): PurposePoint[] {
  const relevant = accountsWithPurpose(snapshots, accountPurposes, overrides, target);
  const relevantSet = new Set(relevant);

  // Per-account snapshots (relevant only), sorted ascending, plus the union of
  // dates on which any relevant account reported.
  const byAccount = new Map<string, SnapshotWithHoldings[]>();
  const dateSet = new Set<string>();
  for (const s of snapshots) {
    if (!relevantSet.has(s.accountId)) continue;
    byAccount.set(s.accountId, [...(byAccount.get(s.accountId) ?? []), s]);
    dateSet.add(s.asOf);
  }
  for (const list of byAccount.values()) list.sort((a, b) => a.asOf.localeCompare(b.asOf));

  return [...dateSet]
    .sort()
    .map((asOf) => {
      let value = 0;
      const present = new Set<string>();
      for (const id of relevant) {
        // Carry forward: the account's most recent snapshot on or before asOf.
        let latest: SnapshotWithHoldings | undefined;
        for (const s of byAccount.get(id) ?? []) {
          if (s.asOf <= asOf) latest = s;
          else break;
        }
        if (!latest) continue;   // account has not reported yet as of this date
        const v = purposeValue(latest, accountPurposes.get(id) ?? 'portfolio', overrides, target);
        if (v === null) continue;
        present.add(id);         // a real $0 is present, not missing
        value += v;
      }
      return {
        asOf,
        value,
        accountsCounted: present.size,
        accountsMissing: relevant.filter((id) => !present.has(id)),
      };
    });
}

function valueAt(
  snapshots: SnapshotWithHoldings[],
  accountPurposes: Map<string, Purpose>,
  overrides: PurposeOverride[],
  target: Purpose,
  accountIds: string[],
  asOf: string,
): number | null {
  let total = 0;
  for (const id of accountIds) {
    const s = snapshots.find((x) => x.accountId === id && x.asOf === asOf);
    if (!s) return null;
    const v = purposeValue(s, accountPurposes.get(id) ?? 'portfolio', overrides, target);
    if (v === null) return null;
    total += v;
  }
  return total;
}

/**
 * Return for one purpose across the household over [t0, t1].
 *
 * Computed only over accounts snapshotted at *both* endpoints; if any relevant
 * account is missing at either end the whole result is `missing`, because a
 * total that silently drops an account is worse than no total at all.
 */
export function purposeReturnBetween(
  snapshots: SnapshotWithHoldings[],
  accountPurposes: Map<string, Purpose>,
  overrides: PurposeOverride[],
  flows: FlowRow[],
  target: Purpose,
  t0: string,
  t1: string,
): PeriodReturn {
  const ids = accountsWithPurpose(snapshots, accountPurposes, overrides, target);
  if (ids.length === 0) return { kind: 'missing', reason: 'no snapshots for this purpose' };

  const v0 = valueAt(snapshots, accountPurposes, overrides, target, ids, t0);
  const v1 = valueAt(snapshots, accountPurposes, overrides, target, ids, t1);
  if (v0 === null) return { kind: 'missing', reason: `no snapshot for every account at ${t0}` };
  if (v1 === null) return { kind: 'missing', reason: `no snapshot for every account at ${t1}` };

  const relevantFlows = flows.filter((f) => ids.includes(f.accountId));
  const external: Flow[] = netInterAccountTransfers(relevantFlows)
    .map((f) => ({ date: f.date, amount: f.amount }));

  return modifiedDietz(v0, v1, external, t0, t1);
}

export { chainReturns };
