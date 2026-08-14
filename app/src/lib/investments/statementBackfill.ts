import type { ParsedHolding } from '@/lib/investments/snapshots';
import { reconcile, ReconciliationError } from '@/lib/investments/snapshots';

export interface StatementFlow {
  date: string;
  amount: number; // our convention: + into account, − out
  kind: 'contribution' | 'withdrawal';
}

/** A per-fund line from the statement's account-activity section. Amount uses the
 *  position convention: + into the position (buy/reinvest), − out (sell). */
export interface ParsedActivityTxn {
  date: string;
  ticker: string | null;
  name: string;
  type: 'buy' | 'sell' | 'reinvest' | 'dividend' | 'other';
  amount: number;
}

export interface ParsedStatement {
  accountRef: { institution: string; mask: string | null; planName: string | null };
  asOf: string;
  reportedTotal: number;
  holdings: ParsedHolding[];
  flows: StatementFlow[];
  activity: ParsedActivityTxn[];
}

const ACTIVITY_TYPES = new Set(['buy', 'sell', 'reinvest', 'dividend']);

const CONTRIB = new Set(['contribution', 'deposit']);
const WITHDRAW = new Set(['withdrawal', 'distribution']);

function str(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error('expected non-empty string');
  return v.trim();
}
function num(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('expected finite number');
  return v;
}
function optStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Normalize one account object from the model's JSON. Throws on malformed input. */
function parseOneAccount(r: Record<string, unknown>): ParsedStatement {
  if (!Array.isArray(r.holdings)) throw new Error('holdings must be an array');
  if (!Array.isArray(r.transactions)) throw new Error('transactions must be an array');

  const holdings: ParsedHolding[] = (r.holdings as Array<Record<string, unknown>>).map((h) => ({
    ticker: typeof h.ticker === 'string' && h.ticker.trim() ? h.ticker.trim() : null,
    name: str(h.name),
    quantity: typeof h.quantity === 'number' && Number.isFinite(h.quantity) ? h.quantity : null,
    value: num(h.value),
  }));

  const flows: StatementFlow[] = [];
  for (const t of r.transactions as Array<Record<string, unknown>>) {
    const sub = (typeof t.subtype === 'string' ? t.subtype : '').toLowerCase();
    const kind = CONTRIB.has(sub) ? 'contribution' : WITHDRAW.has(sub) ? 'withdrawal' : null;
    if (!kind) continue; // buys/sells/dividends/interest/fees belong in the return
    const rawAmount = num(t.amount);
    // Normalize sign by kind: contributions positive, withdrawals negative (our convention: + into, − out).
    const amount = kind === 'contribution' ? Math.abs(rawAmount) : -Math.abs(rawAmount);
    flows.push({ date: str(t.date), amount, kind });
  }

  const activity: ParsedActivityTxn[] = [];
  for (const a of (Array.isArray(r.activity) ? r.activity : []) as Array<Record<string, unknown>>) {
    if (typeof a.date !== 'string' || !a.date.trim()) continue;
    if (typeof a.amount !== 'number' || !Number.isFinite(a.amount)) continue;
    const ticker = typeof a.ticker === 'string' && a.ticker.trim() ? a.ticker.trim() : null;
    const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : ticker;
    if (!name) continue; // need a ticker or name to resolve the security
    const typeRaw = (typeof a.type === 'string' ? a.type : '').toLowerCase();
    const type = (ACTIVITY_TYPES.has(typeRaw) ? typeRaw : 'other') as ParsedActivityTxn['type'];
    activity.push({ date: a.date.trim(), ticker, name, type, amount: a.amount });
  }

  return {
    accountRef: { institution: str(r.institution), mask: optStr(r.accountMask), planName: optStr(r.planName) },
    asOf: str(r.asOf),
    reportedTotal: num(r.reportedTotal),
    holdings,
    flows,
    activity,
  };
}

/**
 * Validate/normalize the model's JSON into per-account statements. Accepts a
 * top-level array, a `{ accounts: [...] }` object, or a single account object.
 */
export function parseStatementExtraction(raw: unknown): ParsedStatement[] {
  const list = Array.isArray(raw)
    ? raw
    : (raw && Array.isArray((raw as Record<string, unknown>).accounts)
        ? (raw as Record<string, unknown>).accounts as unknown[]
        : [raw]);
  return (list as Array<Record<string, unknown>>).map((r) => parseOneAccount(r ?? {}));
}

/** Reuse the snapshot reconciliation: holdings sum vs the statement's printed total. */
export function reconcileStatement(s: ParsedStatement): void {
  const rec = reconcile(s.reportedTotal, s.holdings);
  if (!rec.withinTolerance) {
    throw new ReconciliationError(
      `statement ${s.accountRef.institution}/${s.accountRef.mask ?? s.accountRef.planName ?? '?'} @ ${s.asOf}: holdings sum ${rec.holdingsSum} vs reported ${s.reportedTotal}`,
    );
  }
}

import { eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { commitSnapshot } from '@/lib/investments/snapshots';
import { canonicalInstitution } from '@/lib/accountName';
import { resolveOrCreateSecurity } from '@/lib/investments/securities';
import { mapPlaidSecurity } from '@/lib/plaid/mapSecurity';

type Db = ReturnType<typeof getDb>;

/**
 * Read-only: resolve a statement's account-ref to an existing investment account.
 * Exact-mask match first, then plan-name substring (institution-scoped). Ambiguous
 * (>1) throws — never guess. No match returns null. Creates nothing.
 */
export function resolveStatementAccount(
  ref: { institution: string; mask: string | null; planName: string | null },
  db: Db = getDb(),
): { accountId: string; name: string } | null {
  const wantInst = canonicalInstitution(ref.institution);
  const invest = db.select().from(schema.accounts).all()
    .filter((a) => a.accountClass === 'investment' && canonicalInstitution(a.institution) === wantInst);

  if (ref.mask) {
    const byMask = invest.filter((a) => a.mask === ref.mask);
    if (byMask.length === 1) return { accountId: byMask[0].id, name: byMask[0].name };
    if (byMask.length > 1) throw new Error(`statement ${ref.institution}/${ref.mask} matched ${byMask.length} accounts by mask`);
  }
  // Separate `if` (not `else if`): the model often fills both mask and planName, and a
  // stray/mismatched mask that matches 0 accounts should still fall through to try
  // plan-name before reporting "no match".
  if (ref.planName) {
    const key = ref.planName.toLowerCase();
    const byName = invest.filter((a) => a.name.toLowerCase().includes(key));
    if (byName.length === 1) return { accountId: byName[0].id, name: byName[0].name };
    if (byName.length > 1) throw new Error(`statement ${ref.institution} plan "${ref.planName}" matched ${byName.length} accounts by name`);
  }
  return null;
}

/**
 * Resolve a statement to one investment account, creating it if absent.
 * Ambiguous match throws — never guess.
 */
export function resolveOrCreateStatementAccount(
  ref: { institution: string; mask: string | null; planName: string | null },
  db: Db = getDb(),
): { accountId: string; created: boolean } {
  const found = resolveStatementAccount(ref, db);
  if (found) return { accountId: found.accountId, created: false };

  const wantInst = canonicalInstitution(ref.institution);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const name = ref.planName ? `401k ${ref.planName}` : `${wantInst} Account ${ref.mask ?? ''}`.trim();
  db.insert(schema.accounts).values({
    id, institution: wantInst, name, mask: ref.mask ?? null,
    accountClass: 'investment', type: 'investment', origin: 'statement', status: 'active',
    purpose: 'portfolio', owner: 'Alex', nameSource: 'user', createdAt: now, modifiedAt: now,
  }).run();
  return { accountId: id, created: true };
}

// Sentinel written to cash_flows.superseded_by when a Plaid flow is retired because
// its account is now statement-owned. Any non-null value excludes the flow from reads
// (they filter on isNull(supersededBy)); no code joins this back to a cash_flows.id.
export const STATEMENT_SUPERSEDED = 'statement-authoritative';

export async function importStatement(
  s: ParsedStatement, accountId: string, db: Db = getDb(),
): Promise<{ flows: number; superseded: number; reconciled: boolean }> {
  // Value-authoritative: the statement's stated total is trusted. When holdings
  // don't reconcile with it (e.g. a pending/unsettled transfer inflates a holding),
  // commit the stated total anyway and flag the mismatch — never abort the run.
  const rec = reconcile(s.reportedTotal, s.holdings);
  const now = new Date().toISOString();

  // Snapshot (commitSnapshot replaces this account's snapshot for the date — idempotent).
  await commitSnapshot({
    accountId, asOf: s.asOf, source: 'statement', totalValue: s.reportedTotal, holdings: s.holdings,
    note: rec.withinTolerance ? 'statement backfill' : 'statement backfill (holdings mismatch — value-authoritative)',
    acknowledgeMismatch: !rec.withinTolerance,
  }, db);

  let flows = 0;
  for (const f of s.flows) {
    // Idempotent: skip if this statement flow already exists.
    const existing = db.select().from(schema.cashFlows).all().find(
      (x) => x.source === 'statement' && x.accountId === accountId && x.date === f.date && x.amount === f.amount && x.kind === f.kind,
    );
    if (!existing) {
      db.insert(schema.cashFlows).values({
        id: crypto.randomUUID(), accountId, securityId: null, date: f.date, amount: f.amount, kind: f.kind,
        source: 'statement', confirmed: true, note: 'statement backfill', supersededBy: null, createdAt: now, modifiedAt: now,
      }).run();
      flows += 1;
    }
  }

  // Persist the account-activity lines as investment_transactions (the exchange
  // stream that look-through ROI reads) — BUT only when the account has no Plaid
  // buy/sell coverage, so Fidelity/Plaid-synced accounts (complete Plaid txns) don't
  // double-count exchanges. Vanguard (Plaid gives only dividends/reinvests, no
  // buy/sells) and statement-only accounts fall through and use statement activity.
  // Resolve each security; map reinvest→'buy' with a REINVESTMENT-prefixed name so
  // the ROI reinvestment filter excludes it, dividend→'cash'. Synthetic deterministic
  // id for idempotency across re-runs.
  // "Real" Plaid exchange coverage = non-reinvestment buy/sells (reinvestments are
  // return, not exchanges — Vanguard's Plaid feed is ONLY dividends/reinvests, so it
  // must NOT be gated out of statement activity).
  const hasPlaidExchanges = db.select().from(schema.investmentTransactions).all().some(
    (x) => x.accountId === accountId && (x.type === 'buy' || x.type === 'sell')
      && !x.plaidInvestmentTxnId.startsWith('stmt:') && !/reinvest/i.test(x.name),
  );
  for (const a of hasPlaidExchanges ? [] : s.activity) {
    const sec = await resolveOrCreateSecurity(mapPlaidSecurity({ ticker_symbol: a.ticker, name: a.name }), db);
    const type = a.type === 'sell' ? 'sell' : a.type === 'dividend' ? 'cash' : a.type === 'other' ? 'other' : 'buy';
    const name = a.type === 'reinvest' ? `REINVESTMENT ${a.name}` : a.name;
    const key = `stmt:${accountId}:${a.date}:${a.ticker ?? a.name}:${a.amount}:${a.type}`;
    const existing = db.select().from(schema.investmentTransactions)
      .where(eq(schema.investmentTransactions.plaidInvestmentTxnId, key)).get();
    if (existing) continue;
    db.insert(schema.investmentTransactions).values({
      id: crypto.randomUUID(), accountId, plaidInvestmentTxnId: key, securityId: sec.id,
      date: a.date, name, amount: a.amount, quantity: null, price: null, fees: null,
      type, subtype: a.type, createdAt: now, modifiedAt: now,
    }).run();
  }

  // Statements are authoritative for this account: supersede every remaining Plaid-derived
  // flow for it (matched or not). Plaid flows are per-fund and polluted with internal
  // rebalance legs, so keeping unmatched ones double-counts — statements own the account.
  const plaidFlows = db.select().from(schema.cashFlows).all().filter(
    (x) => x.source === 'plaid' && x.accountId === accountId && x.supersededBy === null,
  );
  let superseded = 0;
  for (const c of plaidFlows) {
    db.update(schema.cashFlows).set({ supersededBy: STATEMENT_SUPERSEDED, modifiedAt: now }).where(eq(schema.cashFlows.id, c.id)).run();
    superseded += 1;
  }
  return { flows, superseded, reconciled: rec.withinTolerance };
}

export interface PlanEntry {
  institution: string;
  mask: string | null;
  planName: string | null;
  asOf: string;
  reportedTotal: number;
  willCreateAccount: boolean;
  existingAccountName: string | null;
  holdingsReconciled: boolean;
  flowCount: number;
  plaidFlowsToSupersede: number;
}

/**
 * Preview what committing these statements would do — WITHOUT writing anything.
 * One entry per account: whether it resolves to an existing account or would be
 * created, whether its holdings reconcile with the stated total, and how many
 * live Plaid flows the commit would supersede.
 */
export function buildImportPlan(statements: ParsedStatement[], db: Db = getDb()): PlanEntry[] {
  return statements.map((s) => {
    const found = resolveStatementAccount(s.accountRef, db);
    const plaidFlowsToSupersede = found
      ? db.select().from(schema.cashFlows).all()
          .filter((x) => x.source === 'plaid' && x.accountId === found.accountId && x.supersededBy === null).length
      : 0;
    return {
      institution: s.accountRef.institution,
      mask: s.accountRef.mask,
      planName: s.accountRef.planName,
      asOf: s.asOf,
      reportedTotal: s.reportedTotal,
      willCreateAccount: found === null,
      existingAccountName: found?.name ?? null,
      holdingsReconciled: reconcile(s.reportedTotal, s.holdings).withinTolerance,
      flowCount: s.flows.length,
      plaidFlowsToSupersede,
    };
  });
}

/**
 * A statement for an account that has been emptied — zero value, nothing held.
 * Institutions issue one when a balance is transferred out (e.g. a platform
 * migration), and importing it would write a $0 snapshot that craters the
 * account's value chart and ROI for that date. Callers should skip it.
 */
export function isEmptyCloseoutStatement(s: ParsedStatement): boolean {
  return s.reportedTotal === 0 && s.holdings.length === 0;
}

/** Delete the synthetic Legacy Household Portfolio account and all its data. No-op if absent. */
export function deleteLegacyAccount(db: Db = getDb()): { deleted: boolean } {
  const legacy = db.select().from(schema.accounts).all().find(
    (a) => canonicalInstitution(a.institution) === canonicalInstitution('Legacy') && a.name === 'Household Portfolio',
  );
  if (!legacy) return { deleted: false };

  const snapIds = db.select().from(schema.investmentSnapshots).all()
    .filter((s) => s.accountId === legacy.id).map((s) => s.id);
  if (snapIds.length > 0) {
    db.delete(schema.snapshotHoldings).where(inArray(schema.snapshotHoldings.snapshotId, snapIds)).run();
    db.delete(schema.investmentSnapshots).where(inArray(schema.investmentSnapshots.id, snapIds)).run();
  }
  db.delete(schema.cashFlows).where(eq(schema.cashFlows.accountId, legacy.id)).run();
  db.delete(schema.accounts).where(eq(schema.accounts.id, legacy.id)).run();
  return { deleted: true };
}

export interface CommitResult {
  institution: string;
  mask: string | null;
  planName: string | null;
  asOf: string;
  accountId: string;
  created: boolean;
  flows: number;
  superseded: number;
  reconciled: boolean;
}

/**
 * Structural guard for the ParsedStatement[] the commit route receives (echoed
 * back from the preview response, so already normalized — NOT raw model JSON).
 * Cheap shape check, not full re-parse: the values were validated at preview time.
 */
export function assertValidStatements(v: unknown): asserts v is ParsedStatement[] {
  if (!Array.isArray(v)) throw new Error('statements must be an array');
  for (const s of v as Array<Record<string, unknown>>) {
    const ref = s?.accountRef as Record<string, unknown> | undefined;
    if (!ref || typeof ref.institution !== 'string') throw new Error('each statement needs accountRef.institution');
    if (typeof s.asOf !== 'string') throw new Error('each statement needs asOf');
    if (typeof s.reportedTotal !== 'number') throw new Error('each statement needs reportedTotal');
    if (!Array.isArray(s.holdings) || !Array.isArray(s.flows)) throw new Error('each statement needs holdings[] and flows[]');
    if (!Array.isArray(s.activity)) throw new Error('each statement needs activity[]');
  }
}

/**
 * Write path for the single-statement upload: resolve-or-create each account,
 * then importStatement (snapshot + flows + supersede plaid). Guards against two
 * statements resolving to one account (their snapshots would overwrite). The
 * caller is responsible for snapshotDb() before this. Does NOT touch the legacy
 * account (that is a one-time backfill concern).
 */
export async function commitStatements(statements: ParsedStatement[], db: Db = getDb()): Promise<CommitResult[]> {
  // Pre-flight, read-only duplicate check — BEFORE any write — so a batch with two
  // statements targeting the same account (existing or about-to-be-created) fails
  // all-or-nothing instead of partially writing the first and throwing on the second.
  const preflightSeen = new Set<string>();
  for (const s of statements) {
    const found = resolveStatementAccount(s.accountRef, db);
    const key = found
      ? found.accountId
      : `new:${canonicalInstitution(s.accountRef.institution)}|${s.accountRef.mask ?? ''}|${s.accountRef.planName ?? ''}`;
    if (preflightSeen.has(key)) {
      throw new Error(`two statements resolved to the same account ${key} — snapshots would overwrite`);
    }
    preflightSeen.add(key);
  }

  const results: CommitResult[] = [];
  for (const s of statements) {
    const { accountId, created } = resolveOrCreateStatementAccount(s.accountRef, db);
    const res = await importStatement(s, accountId, db);
    results.push({
      institution: s.accountRef.institution, mask: s.accountRef.mask, planName: s.accountRef.planName,
      asOf: s.asOf, accountId, created, flows: res.flows, superseded: res.superseded, reconciled: res.reconciled,
    });
  }
  return results;
}
