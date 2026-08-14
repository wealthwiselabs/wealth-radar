// app/src/lib/plaidSuppression.ts
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import type { AccountRow } from '@/lib/accounts';

type Db = ReturnType<typeof getDb>;

/**
 * Record that a Plaid account was individually removed while its parent Item stays
 * connected, so the next sync does not re-provision it. Idempotent: re-removing an
 * already-suppressed account is a no-op (INSERT OR IGNORE on the plaidAccountId PK).
 * A no-op for accounts with no plaidAccountId — a manual/PDF account is never
 * re-created by sync, so there is nothing to suppress.
 */
export function suppressPlaidAccount(acct: AccountRow, db: Db = getDb()): void {
  if (!acct.plaidAccountId) return;
  db.insert(schema.suppressedPlaidAccounts)
    .values({
      plaidAccountId: acct.plaidAccountId,
      plaidItemId: acct.plaidItemId ?? null,
      institution: acct.institution,
      name: acct.name,
      mask: acct.mask ?? null,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
}

/**
 * The set of plaidAccountIds that must never be re-provisioned by sync/exchange.
 * Returned as a Set so provisioning loops do one O(1) membership check per account.
 */
export function listSuppressedPlaidAccountIds(db: Db = getDb()): Set<string> {
  return new Set(
    db.select({ id: schema.suppressedPlaidAccounts.plaidAccountId })
      .from(schema.suppressedPlaidAccounts)
      .all()
      .map((r) => r.id),
  );
}

/**
 * Lift a suppression so the account can sync again (a deliberate "restore"). Returns
 * whether a row was actually removed.
 */
export function unsuppressPlaidAccount(plaidAccountId: string, db: Db = getDb()): { restored: boolean } {
  const existing = db.select().from(schema.suppressedPlaidAccounts)
    .where(eq(schema.suppressedPlaidAccounts.plaidAccountId, plaidAccountId)).get();
  if (!existing) return { restored: false };
  db.delete(schema.suppressedPlaidAccounts)
    .where(eq(schema.suppressedPlaidAccounts.plaidAccountId, plaidAccountId)).run();
  return { restored: true };
}
