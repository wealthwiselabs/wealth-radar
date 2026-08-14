import type { PlaidApi } from 'plaid';
import { eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { getPlaidClient } from '@/lib/plaid/client';
import { snapshotDb } from '@/lib/backup';
import { syncInvestments as defaultSyncInvestments } from '@/lib/plaid/syncInvestments';
import { syncInvestmentTransactions as defaultSyncInvestmentTransactions } from '@/lib/investments/investmentTransactions';
import { classifyUntaggedSecurities } from '@/lib/investments/classifySecurities';

type Db = ReturnType<typeof getDb>;

export async function syncAllInvestments(
  db: Db = getDb(),
  deps: {
    client: PlaidApi;
    syncInvestments?: typeof defaultSyncInvestments;
    syncInvestmentTransactions?: typeof defaultSyncInvestmentTransactions;
    classifyUntagged?: typeof classifyUntaggedSecurities;
    apiKey?: string;
  } = { client: getPlaidClient() },
): Promise<{ items: number; snapshots: number }> {
  snapshotDb('pre-invsync', { db });
  const investmentItemIds = new Set(
    db.select({ id: schema.accounts.plaidItemId }).from(schema.accounts)
      .where(eq(schema.accounts.accountClass, 'investment')).all()
      .map((r) => r.id).filter((id): id is string => Boolean(id)),
  );
  const items = db.select().from(schema.plaidItems)
    .where(inArray(schema.plaidItems.id, [...investmentItemIds])).all();

  let snapshots = 0;
  for (const item of items) {
    try {
      const res = await (deps.syncInvestments ?? defaultSyncInvestments)(item, { client: deps.client }, db);
      snapshots += res.snapshots;
    } catch (err) {
      console.warn(`[plaid] investment sync failed for item ${item.id}:`, String(err));
    }

    try {
      await (deps.syncInvestmentTransactions ?? defaultSyncInvestmentTransactions)(
        { id: item.id, accessToken: item.accessToken }, { client: deps.client }, db,
      );
    } catch (err) {
      console.warn(`[plaid] investment transactions sync failed for item ${item.id}:`, String(err));
    }
  }

  // Classify any securities this sync introduced. Wrapped so a classifier
  // failure never turns a successful sync into an error — snapshots are
  // already committed above.
  try {
    await (deps.classifyUntagged ?? classifyUntaggedSecurities)(db, { apiKey: deps.apiKey });
  } catch (err) {
    console.warn('[plaid] security classification failed after invest sync:', String(err));
  }

  return { items: items.length, snapshots };
}
