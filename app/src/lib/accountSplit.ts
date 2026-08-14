import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { transactionFingerprint } from '@/lib/fingerprint';
import { recomputeMonthlyAggregates } from '@/lib/aggregates';

type Db = ReturnType<typeof getDb>;
type TxRow = typeof schema.transactions.$inferSelect;

export interface SplitTarget {
  owner: string;
  name?: string;          // defaults to the source account's label
  mask?: string | null;
}

/**
 * Move the transactions matching `opts.match` off `sourceId` and onto a new
 * account. Used to separate two people's cards that fused into one row under
 * the old (institution, name) uniqueness rule.
 *
 * Fingerprints are account-scoped, so every moved row is re-fingerprinted;
 * monthly aggregates are recomputed on BOTH sides for every affected month.
 */
export function splitAccount(
  sourceId: string,
  opts: { match: (t: TxRow) => boolean; into: SplitTarget },
  db: Db = getDb(),
): { newAccountId: string; moved: number; statementsMoved: number } {
  const source = db.select().from(schema.accounts).where(eq(schema.accounts.id, sourceId)).get();
  if (!source) throw new Error(`Source account ${sourceId} not found.`);

  const all = db.select().from(schema.transactions).where(eq(schema.transactions.accountId, sourceId)).all();
  const moving = all.filter(opts.match);
  if (moving.length === 0) throw new Error(`Split matched no transactions on ${sourceId}.`);
  if (moving.length === all.length) {
    throw new Error(`Split matched all ${all.length} transactions on ${sourceId} — rename the account instead.`);
  }

  const now = new Date().toISOString();
  const newAccountId = randomUUID();
  const movingIds = new Set(moving.map((t) => t.id));
  const affected = new Set<string>();
  let statementsMoved = 0;

  db.transaction(() => {
    db.insert(schema.accounts).values({
      ...source,
      id: newAccountId,
      owner: opts.into.owner,
      name: opts.into.name ?? source.name,
      mask: opts.into.mask ?? null,
      // The new row is a PDF-derived sibling; Plaid identity stays with the source.
      origin: 'manual',
      plaidItemId: null,
      plaidAccountId: null,
      createdAt: now,
      modifiedAt: now,
    }).run();

    for (const t of moving) {
      db.update(schema.transactions).set({
        accountId: newAccountId,
        fingerprint: transactionFingerprint({
          accountId: newAccountId, date: t.date, description: t.description, amount: t.amount,
        }),
        modifiedAt: now,
      }).where(eq(schema.transactions.id, t.id)).run();
      affected.add(t.month);
    }

    // Re-point statement imports whose file produced only moved transactions.
    const stmts = db.select().from(schema.statementImports)
      .where(eq(schema.statementImports.accountId, sourceId)).all();
    const movedFiles = new Set(moving.map((t) => t.sourceFile).filter(Boolean) as string[]);
    const keptFiles = new Set(all.filter((t) => !movingIds.has(t.id))
      .map((t) => t.sourceFile).filter(Boolean) as string[]);
    for (const s of stmts) {
      if (s.sourceFile && movedFiles.has(s.sourceFile) && !keptFiles.has(s.sourceFile)) {
        db.update(schema.statementImports).set({ accountId: newAccountId })
          .where(eq(schema.statementImports.id, s.id)).run();
        statementsMoved += 1;
        affected.add(s.month);
      }
    }

    for (const month of affected) {
      recomputeMonthlyAggregates(sourceId, month, db);
      recomputeMonthlyAggregates(newAccountId, month, db);
    }
  });

  return { newAccountId, moved: moving.length, statementsMoved };
}
