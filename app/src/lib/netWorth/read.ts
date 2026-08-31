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
  /**
   * Ascending by asOf. A later task's API route scans these flat arrays
   * directly to find an account's newest reading across both sources; the
   * per-account maps below are derived from these same arrays so the two
   * views cannot drift apart.
   */
  balances: Reading[];
  investments: Reading[];
  /** balances grouped by accountId, each still ascending by asOf, so valuationAt never rescans every account's readings. */
  balancesByAccount: Map<string, Reading[]>;
  /** investments grouped by accountId, each still ascending by asOf. */
  investmentsByAccount: Map<string, Reading[]>;
}

function groupByAccount(readings: Reading[]): Map<string, Reading[]> {
  const map = new Map<string, Reading[]>();
  for (const r of readings) {
    const bucket = map.get(r.accountId);
    if (bucket) bucket.push(r);
    else map.set(r.accountId, [r]);
  }
  return map;
}

/**
 * One read of everything the rollup needs. Loaded once per request and passed
 * down, mirroring loadAllocationContext in the investments lib — the alternative
 * is a query per account per period, which is quadratic on the trend chart.
 */
export async function loadNetWorthContext(db: Db = getDb()): Promise<NetWorthContext> {
  const accountRows = db.select().from(accounts).all();
  const balanceRows = db.select().from(balanceSnapshots).all();
  const investmentRows = db.select().from(investmentSnapshots).all();

  const byAsOf = (a: Reading, b: Reading) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0);

  const balances = balanceRows
    .map((r) => ({ accountId: r.accountId, asOf: r.asOf, value: r.balance, source: r.source }))
    .sort(byAsOf);
  const investments = investmentRows
    .map((r) => ({ accountId: r.accountId, asOf: r.asOf, value: r.totalValue, source: r.source }))
    .sort(byAsOf);

  return {
    accounts: accountRows,
    balances,
    investments,
    balancesByAccount: groupByAccount(balances),
    investmentsByAccount: groupByAccount(investments),
  };
}
