import { getDb } from '@/db/client';
import { accounts, balanceSnapshots, investmentSnapshots } from '@/db/schema';
import type { AccountRow } from '@/lib/accounts';

type Db = ReturnType<typeof getDb>;

export interface Reading {
  accountId: string;
  asOf: string;
  value: number;
  source: string;
}

export interface NetWorthContext {
  accounts: AccountRow[];
  /** Ascending by asOf, so a carry-forward scan can stop at the first row past the date. */
  balances: Reading[];
  investments: Reading[];
}

/**
 * One read of everything the rollup needs. Loaded once per request and passed
 * down, mirroring loadAllocationContext in the investments lib — the alternative
 * is a query per account per period, which is quadratic on the trend chart.
 */
export async function loadNetWorthContext(db: Db = getDb()): Promise<NetWorthContext> {
  const accountRows = db.select().from(accounts).all() as AccountRow[];
  const balanceRows = db.select().from(balanceSnapshots).all();
  const investmentRows = db.select().from(investmentSnapshots).all();

  const byAsOf = (a: Reading, b: Reading) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0);

  return {
    accounts: accountRows,
    balances: balanceRows
      .map((r) => ({ accountId: r.accountId, asOf: r.asOf, value: r.balance, source: r.source }))
      .sort(byAsOf),
    investments: investmentRows
      .map((r) => ({ accountId: r.accountId, asOf: r.asOf, value: r.totalValue, source: r.source }))
      .sort(byAsOf),
  };
}
