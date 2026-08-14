// app/src/lib/accountRemoval.ts
import { eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { decryptToken } from '@/lib/crypto';

type Db = ReturnType<typeof getDb>;

/**
 * Hard-delete an account and every row that references it, across all tables.
 * The caller is responsible for snapshotDb() first. Returns {deleted:false} when
 * the account does not exist. `snapshot_holdings` has no account_id — it is
 * cleared via the account's snapshot ids before the snapshots themselves.
 */
export function deleteAccountData(accountId: string, db: Db = getDb()): { deleted: boolean } {
  const acct = db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get();
  if (!acct) return { deleted: false };

  const snapIds = db.select().from(schema.investmentSnapshots).all()
    .filter((s) => s.accountId === accountId).map((s) => s.id);
  if (snapIds.length > 0) {
    db.delete(schema.snapshotHoldings).where(inArray(schema.snapshotHoldings.snapshotId, snapIds)).run();
  }
  db.delete(schema.investmentSnapshots).where(eq(schema.investmentSnapshots.accountId, accountId)).run();
  db.delete(schema.cashFlows).where(eq(schema.cashFlows.accountId, accountId)).run();
  db.delete(schema.investmentTransactions).where(eq(schema.investmentTransactions.accountId, accountId)).run();
  db.delete(schema.securityPurposes).where(eq(schema.securityPurposes.accountId, accountId)).run();
  db.delete(schema.statementImports).where(eq(schema.statementImports.accountId, accountId)).run();
  db.delete(schema.monthlyAggregates).where(eq(schema.monthlyAggregates.accountId, accountId)).run();
  db.delete(schema.transactions).where(eq(schema.transactions.accountId, accountId)).run();
  db.delete(schema.accounts).where(eq(schema.accounts.id, accountId)).run();
  return { deleted: true };
}

/**
 * Disconnect a Plaid connection: best-effort `itemRemove` at Plaid (billing stops),
 * then hard-delete every account under the Item and the Item row. Caller snapshots
 * first. `itemRemove` failing does not stop local deletion — the user wants the
 * connection gone from the app regardless.
 */
export async function removeItem(
  itemId: string,
  deps: { client: { itemRemove: (a: { access_token: string }) => Promise<unknown> } },
  db: Db = getDb(),
): Promise<{ removed: boolean; accounts: number }> {
  const item = db.select().from(schema.plaidItems).where(eq(schema.plaidItems.id, itemId)).get();
  if (!item) return { removed: false, accounts: 0 };

  try {
    await deps.client.itemRemove({ access_token: decryptToken(item.accessToken) });
  } catch (err) {
    console.warn(`[plaid] itemRemove failed for ${itemId} (deleting locally anyway):`, String(err));
  }

  const accts = db.select().from(schema.accounts).all().filter((a) => a.plaidItemId === itemId);
  for (const a of accts) deleteAccountData(a.id, db);
  db.delete(schema.plaidItems).where(eq(schema.plaidItems.id, itemId)).run();
  return { removed: true, accounts: accts.length };
}
