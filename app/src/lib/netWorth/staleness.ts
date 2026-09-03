// app/src/lib/netWorth/staleness.ts
import type { NetWorthContext } from '@/lib/netWorth/read';

export interface StaleAccount {
  accountId: string;
  name: string;
  /** null when the account has never been valued at all. */
  lastAsOf: string | null;
  monthsOverdue: number;
}

/**
 * Whole months between two YYYY-MM-DD dates, by calendar month and
 * day-of-month. Exported so callers outside this module (the register's
 * on-row age display) share this exact adjustment instead of re-deriving
 * their own — the server and the client must never disagree about what
 * counts as stale.
 */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}

/**
 * Accounts whose newest reading is older than their expected refresh cadence.
 *
 * A null reviewIntervalMonths means "never nag" and is correct for anything
 * Plaid feeds — a synced balance is not an estimate going stale. Closed accounts
 * are skipped: you are not asked to re-value a car you sold.
 */
export function staleAccounts(ctx: NetWorthContext, asOf: string): StaleAccount[] {
  const out: StaleAccount[] = [];

  for (const account of ctx.accounts) {
    const interval = account.reviewIntervalMonths;
    if (interval === null || interval === undefined) continue;
    if (account.status === 'closed') continue;

    const readings = [...ctx.balances, ...ctx.investments]
      .filter((r) => r.accountId === account.id && r.asOf <= asOf)
      .sort((a, b) => (a.asOf < b.asOf ? 1 : -1));
    const lastAsOf = readings[0]?.asOf ?? null;

    if (lastAsOf === null) {
      out.push({ accountId: account.id, name: account.name, lastAsOf: null, monthsOverdue: interval });
      continue;
    }
    const age = monthsBetween(lastAsOf, asOf);
    if (age > interval) {
      out.push({ accountId: account.id, name: account.name, lastAsOf, monthsOverdue: age - interval });
    }
  }

  return out.sort((a, b) => b.monthsOverdue - a.monthsOverdue);
}
