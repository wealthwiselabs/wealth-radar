import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { eq, desc, isNull } from 'drizzle-orm';
import { getDb, isProductionDb, resolveDbFile, schema } from '@/db/client';
import { ingestClassifiedBatch } from '@/lib/ingest';
import { maskFromSourceFile } from '@/lib/accountMask';
import { recomputeMonthlyAggregates } from '@/lib/aggregates';
import { normalizePattern, isValidPattern } from '@/lib/categoryRules';
import { PatternTooShortError, PatternConflictError } from '@/lib/ruleErrors';
import type { Transaction, PendingTransaction, Taxonomy, CategoryRule } from '@/types';

type Db = ReturnType<typeof getDb>;
const DATA_DIR = path.join(process.cwd(), 'data');

type AccountRow = typeof schema.accounts.$inferSelect;
type TxRow = typeof schema.transactions.$inferSelect;

function toTransaction(t: TxRow, acc: AccountRow): Transaction {
  return {
    id: t.id, date: t.date, description: t.description, amount: t.amount,
    // Kept as three separate fields so consumers can group by person or by
    // institution; the UI joins them for display.
    owner: acc.owner,
    bank: acc.institution,
    account: acc.name,
    accountId: acc.id, accountClass: acc.accountClass as Transaction['accountClass'],
    accountType: acc.type,
    categoryId: t.categoryId, subcategoryId: t.subcategoryId, note: t.note,
    source: t.sourceFile ?? t.source,
    createdAt: t.createdAt, modifiedAt: t.modifiedAt,
  };
}

export async function readTransactions(db: Db = getDb()): Promise<Transaction[]> {
  const rows = db.select().from(schema.transactions)
    .innerJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
    .where(isNull(schema.transactions.supersededBy))
    .orderBy(desc(schema.transactions.date), desc(schema.transactions.createdAt))
    .all();
  return rows.map((r) => toTransaction(r.transactions, r.accounts));
}

export async function addTransactions(
  // Pre-persistence rows: accountId/accountClass are assigned by the DB layer
  // (resolved from bank/account here), so callers need not supply them.
  newTransactions: PendingTransaction[],
  db: Db = getDb(),
): Promise<{ added: Transaction[]; skipped: number }> {
  // Group by (bank, account, source, mask) so a folder import of multiple monthly
  // statements for one account keeps each file's own sourceFile per batch — and so
  // two different cards present in a single upload resolve to two accounts.
  const groups = new Map<string, PendingTransaction[]>();
  for (const t of newTransactions) {
    const key = `${t.bank}|||${t.account}|||${t.source}|||${t.mask ?? ''}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }

  let addedCount = 0, skipped = 0;
  for (const [key, txns] of groups) {
    const [bank, account, source, rowMask] = key.split('|||');
    const res = await ingestClassifiedBatch({
      // A filename mask is deterministic (Chase's `-statements-3104-`), so it wins.
      // The row mask comes from the statement text and only fills the gap for
      // institutions whose filenames carry nothing.
      account: {
        institution: bank, name: account,
        mask: maskFromSourceFile(source) ?? (rowMask || null),
      },
      source: 'pdf', sourceFile: source || null,
      transactions: txns.map((t) => ({
        date: t.date, description: t.description, amount: t.amount,
        categoryId: t.categoryId, subcategoryId: t.subcategoryId, note: t.note,
      })),
    }, db);
    addedCount += res.added;
    skipped += res.skipped;
  }

  // Return the freshly-visible rows for these accounts (best-effort: return all current).
  const all = await readTransactions(db);
  // added is count-correct only; callers use .length (the sole POST caller re-fetches). Do NOT rely on the row contents.
  return { added: all.slice(0, addedCount), skipped };
}

export async function findTransactionById(id: string, db: Db = getDb()): Promise<Transaction | null> {
  const row = db.select().from(schema.transactions)
    .innerJoin(schema.accounts, eq(schema.transactions.accountId, schema.accounts.id))
    .where(eq(schema.transactions.id, id)).get();
  return row ? toTransaction(row.transactions, row.accounts) : null;
}

export async function updateTransaction(
  id: string,
  updates: Partial<Transaction> & { categorySource?: 'ai' | 'rule' | 'manual' },
  db: Db = getDb(),
): Promise<Transaction | null> {
  const existing = db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get();
  if (!existing) return null;
  const now = new Date().toISOString();
  db.update(schema.transactions).set({
    categoryId: updates.categoryId ?? existing.categoryId,
    subcategoryId: updates.subcategoryId ?? existing.subcategoryId,
    // Omitted means unchanged, so a note-only edit never makes a row
    // rule-immune by accident.
    categorySource: updates.categorySource ?? existing.categorySource,
    note: updates.note ?? existing.note,
    modifiedAt: now,
  }).where(eq(schema.transactions.id, id)).run();
  recomputeMonthlyAggregates(existing.accountId, existing.month, db);
  return findTransactionById(id, db);
}

export async function deleteTransaction(id: string, db: Db = getDb()): Promise<boolean> {
  const existing = db.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get();
  if (!existing) return false;
  db.delete(schema.transactions).where(eq(schema.transactions.id, id)).run();
  recomputeMonthlyAggregates(existing.accountId, existing.month, db);
  return true;
}

/**
 * How far apart the same charge may be dated in a statement PDF and in Plaid
 * and still be one transaction. The two feeds disagree by a day or two because
 * one reports the transaction date and the other the posting date; beyond that,
 * a same-amount charge is far likelier to be a genuine repeat purchase.
 */
const CROSS_SOURCE_DATE_WINDOW_DAYS = 3;

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Hide Plaid rows that restate a charge already imported from a statement PDF.
 *
 * The fingerprint pass cannot see these as equal because the descriptions
 * differ: Plaid returns a cleaned merchant name ("Venmo", "AWS", "Amazon
 * Prime") where the statement carries the raw descriptor ("Venmo *Anne Nguyen
 * Visa Direct NY Card 4584"). So match on what both feeds do agree on —
 * account, exact amount, and a near-identical date — pairing greedily by
 * closest date so N repeats of one charge collapse N-to-N rather than
 * all-into-one.
 *
 * The PLAID row is always the one hidden, never the PDF row:
 *   - the statement descriptor is strictly more informative (it names the payee);
 *   - ingest's fingerprint dedupe skips superseded rows while its externalId
 *     check does not, so hiding the PDF row would let a re-import of the same
 *     statement insert a fresh duplicate. Hiding the Plaid row stays deduped on
 *     both the re-import and the re-sync path.
 *
 * Rows are superseded, not deleted, so the merge is reversible and the Plaid
 * externalId survives for future sync bookkeeping.
 */
function supersedeCrossSourceDuplicates(db: Db, affected: Set<string>): number {
  const rows = db.select().from(schema.transactions)
    .where(isNull(schema.transactions.supersededBy))
    .orderBy(schema.transactions.date).all();

  const byAmount = new Map<string, typeof rows>();
  for (const t of rows) {
    const key = `${t.accountId}|${t.amount.toFixed(2)}`;
    const list = byAmount.get(key);
    if (list) list.push(t);
    else byAmount.set(key, [t]);
  }

  const now = new Date().toISOString();
  let superseded = 0;

  for (const group of byAmount.values()) {
    const pdfRows = group.filter((t) => t.source === 'pdf');
    const plaidRows = group.filter((t) => t.source === 'plaid');
    if (!pdfRows.length || !plaidRows.length) continue;

    const claimed = new Set<string>();
    for (const keep of pdfRows) {
      let best: (typeof rows)[number] | undefined;
      let bestGap = Infinity;
      for (const candidate of plaidRows) {
        if (claimed.has(candidate.id)) continue;
        const gap = daysApart(keep.date, candidate.date);
        if (gap > CROSS_SOURCE_DATE_WINDOW_DAYS || gap >= bestGap) continue;
        best = candidate;
        bestGap = gap;
      }
      if (!best) continue;
      claimed.add(best.id);
      db.update(schema.transactions)
        .set({ supersededBy: keep.id, modifiedAt: now })
        .where(eq(schema.transactions.id, best.id)).run();
      affected.add(`${best.accountId}|${best.month}`);
      superseded += 1;
    }
  }
  return superseded;
}

export async function deduplicateTransactions(db: Db = getDb()): Promise<{ kept: number; removed: number }> {
  const rows = db.select().from(schema.transactions)
    .where(isNull(schema.transactions.supersededBy))
    .orderBy(schema.transactions.createdAt).all();
  const seen = new Set<string>();
  const affected = new Set<string>();
  let removed = 0;
  for (const t of rows) {
    const key = `${t.accountId}|${t.fingerprint}`;
    if (seen.has(key)) {
      db.delete(schema.transactions).where(eq(schema.transactions.id, t.id)).run();
      affected.add(`${t.accountId}|${t.month}`);
      removed += 1;
    } else {
      seen.add(key);
    }
  }

  // Second pass: the same charge arriving from both feeds under different text.
  const superseded = supersedeCrossSourceDuplicates(db, affected);
  removed += superseded;

  for (const k of affected) {
    const [accountId, month] = k.split('|');
    recomputeMonthlyAggregates(accountId, month, db);
  }
  return { kept: seen.size - superseded, removed };
}

// ---- Category rules ----

type RuleRow = typeof schema.categoryRules.$inferSelect;

function toRule(r: RuleRow): CategoryRule {
  return {
    id: r.id, pattern: r.pattern,
    categoryId: r.categoryId, subcategoryId: r.subcategoryId,
    enabled: r.enabled, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

export async function readRules(db: Db = getDb()): Promise<CategoryRule[]> {
  return db.select().from(schema.categoryRules).all().map(toRule);
}

/**
 * Mirrors the rules to data/preferences.json so the off-site backup repo keeps
 * a versioned, human-readable copy — the same role the file played for merchant
 * preferences. Best-effort: a failure here must never fail a rule mutation.
 */
export async function exportRules(db: Db = getDb()): Promise<void> {
  // The mirror only makes sense for the one real application database.
  // Any other handle (a test's temp sqlite file, a one-off script's db, etc.)
  // has no business overwriting the user's real data/preferences.json, so we
  // skip the write entirely. This is what keeps `npm test` (and any future
  // script that calls a rule mutator against a scratch db) from clobbering
  // the real file, without relying on every caller remembering to mock fs.
  // Uses isProductionDb (not `db !== getDb()`) so this check can never itself
  // initialize the production db singleton and can never throw.
  if (!isProductionDb(db)) return;
  try {
    const rules = await readRules(db);
    const payload = rules.map((r) => ({
      pattern: r.pattern, categoryId: r.categoryId,
      subcategoryId: r.subcategoryId, enabled: r.enabled,
    }));
    // Derived from the resolved database file's own directory (which honours
    // DATABASE_URL), NOT from the module-level DATA_DIR: a server process can
    // be pointed at a database anywhere via DATABASE_URL, and the mirror must
    // land next to *that* database, not next to whatever data/ directory this
    // process happens to have been started from. Using DATA_DIR here let an
    // e2e server running against an isolated data/e2e/e2e.db silently overwrite
    // the real data/preferences.json on every rule mutation, because
    // isProductionDb() only checks identity against this process's own
    // memoized db singleton — it can't tell that this process's "production"
    // db isn't the one the user cares about. readTaxonomy(), below, is
    // different: taxonomy.json is a checked-in config file that always lives
    // at process.cwd()/data regardless of which database is active, so it
    // correctly keeps using DATA_DIR.
    await fs.writeFile(
      path.join(path.dirname(resolveDbFile()), 'preferences.json'),
      JSON.stringify(payload, null, 2),
      'utf-8',
    );
  } catch {
    // Backup mirroring is not worth failing a user action over.
  }
}

/** Creates a rule, or updates the existing rule with the same pattern. */
export async function createRule(
  input: { pattern: string; categoryId: string; subcategoryId: string; enabled?: boolean },
  db: Db = getDb(),
): Promise<CategoryRule> {
  const pattern = normalizePattern(input.pattern);
  if (!isValidPattern(pattern)) {
    throw new PatternTooShortError();
  }
  const now = new Date().toISOString();
  const existing = db.select().from(schema.categoryRules)
    .where(eq(schema.categoryRules.pattern, pattern)).get();

  if (existing) {
    db.update(schema.categoryRules).set({
      categoryId: input.categoryId, subcategoryId: input.subcategoryId,
      enabled: input.enabled ?? true, updatedAt: now,
    }).where(eq(schema.categoryRules.id, existing.id)).run();
    const rule = toRule(db.select().from(schema.categoryRules)
      .where(eq(schema.categoryRules.id, existing.id)).get()!);
    await exportRules(db);
    return rule;
  }

  const id = randomUUID();
  db.insert(schema.categoryRules).values({
    id, pattern,
    categoryId: input.categoryId, subcategoryId: input.subcategoryId,
    enabled: input.enabled ?? true, createdAt: now, updatedAt: now,
  }).run();
  const rule = toRule(db.select().from(schema.categoryRules).where(eq(schema.categoryRules.id, id)).get()!);
  await exportRules(db);
  return rule;
}

export async function updateRule(
  id: string,
  updates: Partial<Pick<CategoryRule, 'pattern' | 'categoryId' | 'subcategoryId' | 'enabled'>>,
  db: Db = getDb(),
): Promise<CategoryRule | null> {
  const existing = db.select().from(schema.categoryRules).where(eq(schema.categoryRules.id, id)).get();
  if (!existing) return null;

  const pattern = updates.pattern === undefined ? existing.pattern : normalizePattern(updates.pattern);
  if (!isValidPattern(pattern)) {
    throw new PatternTooShortError();
  }

  // Detect a UNIQUE collision ourselves — rather than letting the write
  // throw a raw SQLite error up to the API route — so callers get a typed
  // error naming the conflicting pattern instead of a 500.
  const conflict = db.select().from(schema.categoryRules)
    .where(eq(schema.categoryRules.pattern, pattern)).get();
  if (conflict && conflict.id !== id) {
    throw new PatternConflictError(pattern);
  }

  db.update(schema.categoryRules).set({
    pattern,
    categoryId: updates.categoryId ?? existing.categoryId,
    subcategoryId: updates.subcategoryId ?? existing.subcategoryId,
    enabled: updates.enabled ?? existing.enabled,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.categoryRules.id, id)).run();

  const rule = toRule(db.select().from(schema.categoryRules).where(eq(schema.categoryRules.id, id)).get()!);
  await exportRules(db);
  return rule;
}

export async function deleteRule(id: string, db: Db = getDb()): Promise<boolean> {
  const existing = db.select().from(schema.categoryRules).where(eq(schema.categoryRules.id, id)).get();
  if (!existing) return false;
  db.delete(schema.categoryRules).where(eq(schema.categoryRules.id, id)).run();
  await exportRules(db);
  return true;
}

// ---- Taxonomy (unchanged: JSON config) ----

export async function readTaxonomy(): Promise<Taxonomy> {
  const filePath = path.join(DATA_DIR, 'taxonomy.json');
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}
