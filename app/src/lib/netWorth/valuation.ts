import type { NetWorthContext, Reading } from '@/lib/netWorth/read';

/** `readings` must already be narrowed to one account (e.g. via a NetWorthContext byAccount map). */
function latestAtOrBefore(readings: Reading[] | undefined, date: string): number | null {
  if (!readings) return null;
  let best: Reading | null = null;
  for (const r of readings) {
    if (r.asOf > date) continue;
    if (best === null || r.asOf > best.asOf) best = r;
  }
  return best ? best.value : null;
}

/**
 * An account's value on `date`, carried forward from its most recent reading.
 *
 * This is the same rule householdValueAt already uses for investments: the
 * newest snapshot at or before the date stands until a newer one replaces it.
 * A house valued in February is worth February's number in May — that is an
 * assumption, and staleAccounts() is what makes it visible rather than silent.
 *
 * Returns null — never 0 — when the account has no reading at or before the
 * date. Callers must exclude a null and report it, because a missing reading
 * is not an empty account.
 *
 * Investment-class accounts prefer investment_snapshots (authoritative, and the
 * only table carrying holdings); everything else prefers balance_snapshots. Each
 * falls back to the other so a manually-entered HSA works either way.
 */
export function valuationAt(ctx: NetWorthContext, accountId: string, date: string): number | null {
  const account = ctx.accounts.find((a) => a.id === accountId);
  const preferInvestments = account?.accountClass === 'investment';
  const first = preferInvestments ? ctx.investmentsByAccount : ctx.balancesByAccount;
  const second = preferInvestments ? ctx.balancesByAccount : ctx.investmentsByAccount;
  const primary = latestAtOrBefore(first.get(accountId), date);
  return primary !== null ? primary : latestAtOrBefore(second.get(accountId), date);
}
