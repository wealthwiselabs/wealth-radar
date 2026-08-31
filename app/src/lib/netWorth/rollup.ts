import type { NetWorthContext } from '@/lib/netWorth/read';
import { valuationAt } from '@/lib/netWorth/valuation';
import { netWorthSide } from '@/lib/netWorth/side';
import { enumerateAllocationPeriods, type AllocationBasis } from '@/lib/investments/periods';
import type { AccountRow } from '@/lib/accounts';

export interface NetWorthTotals {
  assetsLiquid: number;
  assetsIlliquid: number;
  assets: number;
  liabilities: number;
  net: number;
  /** Names of accounts with no reading at or before the date. Never summed as 0. */
  missing: string[];
}

export interface SeriesPoint extends NetWorthTotals {
  key: string;
  label: string;
  date: string;
}

/**
 * An account still counts through the end of the month it was closed in, and
 * not after. Without this, carry-forward would keep a sold car on the books
 * forever — but zeroing it retroactively would rewrite the trend, which is why
 * closing is a status change rather than a delete.
 */
function isCountable(a: AccountRow, date: string): boolean {
  if (a.status !== 'closed') return true;
  if (!a.closedAtMonth) return false;
  return date.slice(0, 7) <= a.closedAtMonth;
}

export function netWorthAt(ctx: NetWorthContext, date: string): NetWorthTotals {
  let assetsLiquid = 0, assetsIlliquid = 0, liabilities = 0;
  const missing: string[] = [];

  for (const account of ctx.accounts) {
    const side = netWorthSide(account);
    if (side === 'excluded') continue;
    if (!isCountable(account, date)) continue;

    const value = valuationAt(ctx, account.id, date);
    if (value === null) {
      // Never a zero. The caller surfaces this list so the total's incompleteness
      // is stated rather than silently absorbed.
      missing.push(account.name);
      continue;
    }

    if (side === 'liability') liabilities += value;
    else if (account.accountClass === 'asset') assetsIlliquid += value;
    else assetsLiquid += value;
  }

  const assets = assetsLiquid + assetsIlliquid;
  return { assetsLiquid, assetsIlliquid, assets, liabilities, net: assets - liabilities, missing };
}

export function netWorthSeries(
  ctx: NetWorthContext, from: string, to: string, basis: AllocationBasis,
): SeriesPoint[] {
  return enumerateAllocationPeriods(from, to, basis).map((p) => ({
    key: p.key, label: p.label, date: p.endDate, ...netWorthAt(ctx, p.endDate),
  }));
}
