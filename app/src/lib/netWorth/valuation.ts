import type { NetWorthContext, Reading } from '@/lib/netWorth/read';

function latestAtOrBefore(readings: Reading[], accountId: string, date: string): number | null {
  let best: Reading | null = null;
  for (const r of readings) {
    if (r.accountId !== accountId) continue;
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
  const first = preferInvestments ? ctx.investments : ctx.balances;
  const second = preferInvestments ? ctx.balances : ctx.investments;
  const primary = latestAtOrBefore(first, accountId, date);
  return primary !== null ? primary : latestAtOrBefore(second, accountId, date);
}
