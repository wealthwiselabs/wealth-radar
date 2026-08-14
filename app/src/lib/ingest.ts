import { randomUUID } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { resolveOrCreateAccount } from '@/lib/accounts';
import { transactionFingerprint } from '@/lib/fingerprint';
import { recomputeMonthlyAggregates, monthOf } from '@/lib/aggregates';

type Db = ReturnType<typeof getDb>;

export interface IngestTxn {
  date: string; description: string; amount: number;
  categoryId: string; subcategoryId: string; note?: string;
  externalId?: string | null; plaidCategory?: string | null; pending?: boolean;
}

export interface IngestBatch {
  account: {
    institution: string; name: string; owner?: string; mask?: string | null;
    accountClass?: 'spending' | 'investment'; type?: string; subtype?: string | null;
    origin?: 'plaid' | 'manual'; plaidAccountId?: string | null;
  };
  source: 'pdf' | 'plaid' | 'manual';
  sourceFile?: string | null;
  transactions: IngestTxn[];
}

export async function ingestClassifiedBatch(
  batch: IngestBatch,
  db: Db = getDb(),
): Promise<{ added: number; skipped: number; accountId: string }> {
  const account = await resolveOrCreateAccount(
    { origin: batch.source === 'plaid' ? 'plaid' : 'manual', ...batch.account },
    db,
  );

  let added = 0, skipped = 0;
  const affectedMonths = new Set<string>();
  const now = new Date().toISOString();

  const run = () => {
    for (const t of batch.transactions) {
      // Every month the batch touches is "affected" — even if all its txns dedupe —
      // so aggregates recompute and (for pdf) statement coverage is recorded.
      const month = monthOf(t.date);
      affectedMonths.add(month);

      const fingerprint = transactionFingerprint({
        accountId: account.id, date: t.date, description: t.description, amount: t.amount,
      });

      const dupByExternal = t.externalId
        ? db.select({ id: schema.transactions.id }).from(schema.transactions)
            .where(and(eq(schema.transactions.accountId, account.id), eq(schema.transactions.externalId, t.externalId)))
            .get()
        : undefined;
      const dupByFingerprint = db.select({ id: schema.transactions.id }).from(schema.transactions)
        .where(and(
          eq(schema.transactions.accountId, account.id),
          eq(schema.transactions.fingerprint, fingerprint),
          isNull(schema.transactions.supersededBy),
        )).get();

      if (dupByExternal || dupByFingerprint) { skipped += 1; continue; }

      db.insert(schema.transactions).values({
        id: randomUUID(), accountId: account.id, date: t.date, month,
        description: t.description, amount: t.amount,
        categoryId: t.categoryId, subcategoryId: t.subcategoryId, note: t.note ?? '',
        source: batch.source, externalId: t.externalId ?? null, fingerprint,
        plaidCategory: t.plaidCategory ?? null, pending: t.pending ?? false,
        sourceFile: batch.sourceFile ?? null, supersededBy: null,
        createdAt: now, modifiedAt: now,
      }).run();
      added += 1;
    }

    for (const month of affectedMonths) {
      recomputeMonthlyAggregates(account.id, month, db);
      if (batch.source === 'pdf') {
        const existing = db.select({ id: schema.statementImports.id }).from(schema.statementImports)
          .where(and(eq(schema.statementImports.accountId, account.id), eq(schema.statementImports.month, month)))
          .get();
        if (!existing) {
          db.insert(schema.statementImports).values({
            id: randomUUID(), accountId: account.id, month,
            sourceFile: batch.sourceFile ?? null, importedAt: now,
          }).run();
        }
      }
    }
  };

  // better-sqlite3 transactions are synchronous.
  db.transaction(() => run());

  return { added, skipped, accountId: account.id };
}
