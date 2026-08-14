import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { transactionFingerprint } from '@/lib/fingerprint';
import { recomputeMonthlyAggregates } from '@/lib/aggregates';

type Db = ReturnType<typeof getDb>;

export function mergeAccounts(targetId: string, sourceIds: string[], db: Db = getDb()) {
  sourceIds = [...new Set(sourceIds)];

  const target = db.select().from(schema.accounts).where(eq(schema.accounts.id, targetId)).get();
  if (!target) throw new Error(`Target account ${targetId} not found.`);
  for (const sid of sourceIds) {
    if (!db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.id, sid)).get())
      throw new Error(`Source account ${sid} not found.`);
  }
  if (sourceIds.includes(targetId)) throw new Error('Cannot merge an account into itself.');

  const sources = sourceIds.map((sid) =>
    db.select().from(schema.accounts).where(eq(schema.accounts.id, sid)).get()!);

  // Two live Plaid accounts cannot become one row: whichever plaidAccountId is
  // dropped would have its future syncs orphaned, and resolveOrCreateAccount
  // (which looks Plaid accounts up by plaidAccountId alone) would silently
  // recreate that account on the next sync.
  const plaidSources = sources.filter((s) => s.plaidAccountId);
  if (target.plaidAccountId && plaidSources.length > 0) {
    throw new Error(
      `Cannot merge: target "${target.institution} ${target.name}" and ` +
      `${plaidSources.length} source(s) are both linked to live Plaid accounts.`,
    );
  }
  if (plaidSources.length > 1) {
    throw new Error(`Cannot merge ${plaidSources.length} live Plaid accounts into one row.`);
  }

  let reassigned = 0, deduped = 0;
  const affected = new Set<string>();
  const now = new Date().toISOString();

  // Dedup against the target's PRE-MERGE visible rows only. Each source's keys
  // are added to these sets AFTER finishing that source, so within one source
  // two genuinely-distinct rows sharing a fingerprint are BOTH kept, while
  // pre-existing-target and cross-source true duplicates are still caught.
  const targetFps = new Set<string>(
    db.select({ fp: schema.transactions.fingerprint }).from(schema.transactions)
      .where(and(eq(schema.transactions.accountId, targetId), isNull(schema.transactions.supersededBy)))
      .all().map((r) => r.fp),
  );
  const targetExtIds = new Set<string>(
    db.select({ e: schema.transactions.externalId }).from(schema.transactions)
      .where(eq(schema.transactions.accountId, targetId)).all().map((r) => r.e).filter(Boolean) as string[],
  );

  db.transaction(() => {
    for (const sid of sourceIds) {
      const rows = db.select().from(schema.transactions).where(eq(schema.transactions.accountId, sid)).all();
      const reassignedThisSource: { fp: string; ext: string | null }[] = [];
      for (const r of rows) {
        const fp = transactionFingerprint({ accountId: targetId, date: r.date, description: r.description, amount: r.amount });
        const isDup = targetFps.has(fp) || (r.externalId != null && targetExtIds.has(r.externalId));
        if (isDup) {
          db.delete(schema.transactions).where(eq(schema.transactions.id, r.id)).run();
          deduped += 1;
        } else {
          db.update(schema.transactions).set({ accountId: targetId, fingerprint: fp, modifiedAt: now })
            .where(eq(schema.transactions.id, r.id)).run();
          reassigned += 1;
          reassignedThisSource.push({ fp, ext: r.externalId });
        }
        affected.add(r.month);
      }
      // Commit this source's reassigned keys so later sources dedup against them.
      for (const k of reassignedThisSource) {
        targetFps.add(k.fp);
        if (k.ext) targetExtIds.add(k.ext);
      }

      // statement_imports: re-point, skipping months the target already covers.
      const stmts = db.select().from(schema.statementImports).where(eq(schema.statementImports.accountId, sid)).all();
      for (const s of stmts) {
        const exists = db.select({ id: schema.statementImports.id }).from(schema.statementImports)
          .where(and(eq(schema.statementImports.accountId, targetId), eq(schema.statementImports.month, s.month))).get();
        if (exists) db.delete(schema.statementImports).where(eq(schema.statementImports.id, s.id)).run();
        else db.update(schema.statementImports).set({ accountId: targetId }).where(eq(schema.statementImports.id, s.id)).run();
      }

      db.delete(schema.monthlyAggregates).where(eq(schema.monthlyAggregates.accountId, sid)).run();
      db.delete(schema.accounts).where(eq(schema.accounts.id, sid)).run();
    }

    // Absorb the surviving identity/lifecycle facts from the sources. This runs
    // AFTER the source rows are deleted: adopting the donor's mask can make the
    // target's (owner, institution, name, mask) identical to the source's, and
    // doing it first would collide on the unique index while both rows exist.
    // `sources` holds pre-delete snapshots, so the values are still available.
    const donor = plaidSources[0];
    const anyOpen = [target, ...sources].some((a) => a.closedAtMonth == null);
    const closes = [target, ...sources].map((a) => a.closedAtMonth).filter(Boolean) as string[];

    db.update(schema.accounts).set({
      ...(donor && !target.plaidAccountId ? {
        plaidAccountId: donor.plaidAccountId,
        plaidItemId: donor.plaidItemId,
        mask: target.mask ?? donor.mask,
        type: donor.type,
        subtype: donor.subtype,
        origin: donor.origin,
      } : {}),
      closedAtMonth: anyOpen || closes.length === 0 ? null : closes.reduce((a, b) => (a > b ? a : b)),
      modifiedAt: now,
    }).where(eq(schema.accounts.id, targetId)).run();

    for (const month of affected) recomputeMonthlyAggregates(targetId, month, db);
  });

  return { reassigned, deduped, mergedAccounts: sourceIds.length };
}
