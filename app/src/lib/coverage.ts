import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { accountDisplayName } from '@/lib/accountDisplay';

type Db = ReturnType<typeof getDb>;
export type CellState = 'covered' | 'missing' | 'na';
export interface AccountCoverage {
  accountId: string;
  display: string;
  owner: string;
  accountClass: string;
  status: string;
  /** Derived from the earliest statement/transaction; not user-settable. */
  activeFromMonth: string | null;
  closedAtMonth: string | null;
  cells: { month: string; state: CellState; reason?: string }[];
}
export interface CoverageResult {
  months: string[];
  accounts: AccountCoverage[];
  gaps: { accountId: string; display: string; month: string; reason?: string }[];
}

export function monthsWindow(now: string, monthsBack: number): string[] {
  const d = new Date(now); const y = d.getUTCFullYear(); const m = d.getUTCMonth(); // 0-based
  const out: string[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - i, 1));
    out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function earliestEvidenceMonth(accountId: string, db: Db = getDb()): string | null {
  const months: string[] = [];
  const s = db.select({ m: schema.statementImports.month }).from(schema.statementImports)
    .where(eq(schema.statementImports.accountId, accountId)).all().map(r => r.m);
  const t = db.select({ m: schema.transactions.month }).from(schema.transactions)
    .where(eq(schema.transactions.accountId, accountId)).all().map(r => r.m);
  months.push(...s, ...t);
  return months.length ? months.reduce((a, b) => (a < b ? a : b)) : null;
}

export function computeCoverage(opts: { monthsBack?: number; now?: string } = {}, db: Db = getDb()): CoverageResult {
  const now = opts.now ?? new Date().toISOString();
  const currentMonth = now.slice(0, 7);
  const months = monthsWindow(now, opts.monthsBack ?? 12);

  const accts = db.select().from(schema.accounts).all();
  const items = new Map(db.select().from(schema.plaidItems).all().map(i => [i.id, i]));

  const result: CoverageResult = { months, accounts: [], gaps: [] };
  for (const a of accts) {
    // Derived purely from evidence (earliest statement or transaction). The
    // manual per-account override was removed — it was never set on any
    // account, so this fallback was already doing all the work.
    const activeFrom = earliestEvidenceMonth(a.id, db);
    const stmts = new Set(db.select({ m: schema.statementImports.month }).from(schema.statementImports)
      .where(eq(schema.statementImports.accountId, a.id)).all().map(r => r.m));
    const item = a.plaidItemId ? items.get(a.plaidItemId) : undefined;
    const display = accountDisplayName(a, accts);

    const cells = months.map((month) => {
      let state: CellState = 'na'; let reason: string | undefined;
      const beforeStart = !activeFrom || month < activeFrom;
      const afterClose = a.closedAtMonth != null && month > a.closedAtMonth;
      const future = month > currentMonth;
      if (!beforeStart && !afterClose && !future) {
        let covered: boolean;
        if (item) { covered = item.status === 'healthy' && item.syncedThroughMonth != null && month <= item.syncedThroughMonth;
          reason = covered ? undefined : (item.status !== 'healthy' ? 'connection needs re-login' : 'not synced yet'); }
        else { covered = stmts.has(month); reason = covered ? undefined : 'no statement uploaded'; }
        state = covered ? 'covered' : 'missing';
        if (state === 'missing') result.gaps.push({ accountId: a.id, display, month, reason });
      }
      return { month, state, reason };
    });

    result.accounts.push({ accountId: a.id, display, owner: a.owner, accountClass: a.accountClass, status: a.status,
      activeFromMonth: activeFrom, closedAtMonth: a.closedAtMonth, cells });
  }
  // Group by owner so the grid reads as one block per person, then within a
  // person surface the most-broken accounts first, then display for stability.
  // Unassigned accounts ('') sort last rather than first, where they'd push a
  // real person's block down the grid.
  const ownerRank = (o: string) => (o ? `0${o}` : '1');
  result.accounts.sort((x, y) =>
    ownerRank(x.owner).localeCompare(ownerRank(y.owner))
    || (y.cells.filter((c) => c.state === 'missing').length - x.cells.filter((c) => c.state === 'missing').length)
    || x.display.localeCompare(y.display));
  return result;
}
