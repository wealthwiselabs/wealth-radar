import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { listSnapshots, type SnapshotWithHoldings } from '@/lib/investments/snapshots';
import type { Purpose, PurposeOverride } from '@/lib/investments/purpose';
import type { FlowRow } from '@/lib/investments/transfers';
import type { GridContext, GridAccount } from '@/lib/investments/grid';
import type { AllocContext, TagSet } from '@/lib/investments/allocation';

type Db = ReturnType<typeof getDb>;

export interface InvestmentAccountView {
  id: string;
  institution: string;
  name: string;
  owner: string;
  purpose: Purpose;
  latestValue: number | null;
  latestAsOf: string | null;
  /** No snapshot within the current month — the signal the sheet never gave. */
  stale: boolean;
}

export async function listInvestmentAccounts(
  today: string,
  db: Db = getDb(),
): Promise<InvestmentAccountView[]> {
  const rows = db.select().from(schema.accounts)
    .where(eq(schema.accounts.accountClass, 'investment')).all();

  const snaps = await listSnapshots(null, db);
  const latest = new Map<string, SnapshotWithHoldings>();
  for (const s of snaps) {
    const prev = latest.get(s.accountId);
    if (!prev || s.asOf > prev.asOf) latest.set(s.accountId, s);
  }

  const currentMonth = today.slice(0, 7);
  // A snapshot dated in the current month or the one just before it counts as
  // fresh — statements land a few days into the following month, so requiring
  // the current calendar month would flag every account stale on the 1st.
  const priorMonthDate = new Date(`${currentMonth}-01T00:00:00Z`);
  priorMonthDate.setUTCMonth(priorMonthDate.getUTCMonth() - 1);
  const staleThreshold = priorMonthDate.toISOString().slice(0, 7);

  return rows
    .map((r) => {
      const s = latest.get(r.id);
      return {
        id: r.id,
        institution: r.institution,
        name: r.name,
        owner: r.owner,
        purpose: (r.purpose ?? 'portfolio') as Purpose,
        latestValue: s?.totalValue ?? null,
        latestAsOf: s?.asOf ?? null,
        stale: !s || s.month < staleThreshold,
      };
    })
    .sort((a, b) => (a.owner + a.institution + a.name).localeCompare(b.owner + b.institution + b.name));
}

/** Everything the return engine needs, loaded once. */
export async function loadPortfolioContext(db: Db = getDb()): Promise<{
  snapshots: SnapshotWithHoldings[];
  accountPurposes: Map<string, Purpose>;
  overrides: PurposeOverride[];
  flows: FlowRow[];
}> {
  const snapshots = await listSnapshots(null, db);

  const accountPurposes = new Map<string, Purpose>(
    db.select().from(schema.accounts).all()
      .map((a) => [a.id, (a.purpose ?? 'portfolio') as Purpose]),
  );

  const overrides: PurposeOverride[] = db.select().from(schema.securityPurposes).all()
    .map((o) => ({ accountId: o.accountId, securityId: o.securityId, purpose: o.purpose as Purpose }));

  // Unconfirmed flows are suggestions; they must not move a reported return.
  const flows: FlowRow[] = db.select().from(schema.cashFlows)
    .where(and(eq(schema.cashFlows.confirmed, true), isNull(schema.cashFlows.supersededBy))).all()
    .map((f) => ({ id: f.id, accountId: f.accountId, date: f.date, amount: f.amount, kind: f.kind, securityId: f.securityId ?? null }));

  return { snapshots, accountPurposes, overrides, flows };
}

/** Everything the returns grid needs, loaded once. */
export async function loadGridContext(db: Db = getDb()): Promise<GridContext> {
  const base = await loadPortfolioContext(db);
  const accounts: GridAccount[] = db.select().from(schema.accounts).all()
    .filter((a) => a.accountClass === 'investment')
    .map((a) => ({
      id: a.id, institution: a.institution, name: a.name, owner: a.owner,
      purpose: (a.purpose ?? 'portfolio') as Purpose,
    }));
  const assetTypeBySecurity = new Map<string, string>(
    db.select().from(schema.securities).all().map((s) => [s.id, s.assetType]));
  return { ...base, accounts, assetTypeBySecurity };
}

/** Everything the allocation tree needs, loaded once. */
export async function loadAllocationContext(db: Db = getDb()): Promise<AllocContext> {
  const base = await loadPortfolioContext(db);
  const tagsBySecurity = new Map<string, TagSet>(
    db.select().from(schema.securities).all().map((s) => [s.id, {
      assetType: s.assetType, region: s.region, cap: s.cap, style: s.style, sector: s.sector,
      kind: s.kind, ticker: s.ticker, name: s.name,
    }]),
  );
  const exchanges = db.select().from(schema.investmentTransactions).all().map((t) => ({
    accountId: t.accountId, securityId: t.securityId ?? null, date: t.date, amount: t.amount, type: t.type, name: t.name,
  }));
  const accountLabels = new Map<string, string>(
    db.select().from(schema.accounts).all()
      .filter((a) => a.accountClass === 'investment')
      .map((a) => [a.id, `${a.institution} · ${a.name}`]),
  );
  return { ...base, tagsBySecurity, exchanges, accountLabels };
}

export interface ReserveFlow {
  id: string; accountId: string; accountLabel: string;
  date: string; amount: number; kind: string; note: string;
}

export async function listReserveFlows(from: string, to: string, db: Db = getDb()): Promise<ReserveFlow[]> {
  const reserveAccounts = new Map(
    db.select().from(schema.accounts).all()
      .filter((a) => a.accountClass === 'investment' && (a.purpose ?? 'portfolio') === 'reserve')
      .map((a) => [a.id, `${a.institution} · ${a.name}`]),
  );
  return db.select().from(schema.cashFlows)
    .where(and(eq(schema.cashFlows.confirmed, true), isNull(schema.cashFlows.supersededBy))).all()
    .filter((f) => reserveAccounts.has(f.accountId))
    .filter((f) => f.date >= from && f.date <= to)
    .map((f) => ({
      id: f.id, accountId: f.accountId, accountLabel: reserveAccounts.get(f.accountId)!,
      date: f.date, amount: f.amount, kind: f.kind, note: f.note,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
