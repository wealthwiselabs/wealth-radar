import type { PlaidApi } from 'plaid';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { decryptToken } from '@/lib/crypto';
import { getAccountByPlaidId } from '@/lib/accounts';
import { commitSnapshot, ReconciliationError, type ParsedHolding } from '@/lib/investments/snapshots';
import { mapPlaidSecurity } from '@/lib/plaid/mapSecurity';

type Db = ReturnType<typeof getDb>;
type ItemRow = typeof schema.plaidItems.$inferSelect;

export interface InvestmentsSyncDeps {
  client: Pick<PlaidApi, 'investmentsHoldingsGet' | 'accountsGet'>;
}

function errorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
}

// Codes where Plaid is telling us holdings are genuinely unavailable for this
// item, as opposed to a transient/auth/unknown failure. Only these justify
// falling back to a value-only snapshot; anything else must leave the prior
// snapshot untouched (see commitSnapshot's REPLACE semantics below).
const HOLDINGS_UNAVAILABLE_CODES = new Set(['PRODUCTS_NOT_SUPPORTED', 'NO_INVESTMENT_ACCOUNTS']);

/**
 * Pull current investment holdings/values for one item and write a snapshot per
 * investment account. Never throws: a bad item or unsupported product yields
 * fewer snapshots, not an exception, so the caller's loop is never aborted.
 */
export async function syncInvestments(
  item: ItemRow,
  deps: InvestmentsSyncDeps,
  db: Db = getDb(),
): Promise<{ snapshots: number; skipped: number }> {
  const asOf = new Date().toISOString().slice(0, 10);
  let accessToken: string;
  try {
    accessToken = decryptToken(item.accessToken);
  } catch (err) {
    console.warn(`[plaid] could not decrypt access token for item ${item.id}; skipping`);
    return { snapshots: 0, skipped: 0 };
  }
  let snapshots = 0, skipped = 0;

  // Try full holdings first; fall back to value-only from accountsGet.
  let holdingsData: {
    accounts: Array<{ account_id: string; balances?: { current?: number | null } }>;
    holdings: Array<{ account_id: string; security_id: string; quantity: number; institution_value: number }>;
    securities: Array<{ security_id: string; ticker_symbol?: string | null; name?: string | null; type?: string | null }>;
  };

  try {
    const resp = await deps.client.investmentsHoldingsGet({ access_token: accessToken });
    holdingsData = resp.data as unknown as typeof holdingsData;
    db.update(schema.plaidItems).set({ needsInvestmentsConsent: false, modifiedAt: new Date().toISOString() })
      .where(eq(schema.plaidItems.id, item.id)).run();
  } catch (err) {
    const code = errorCode(err);
    if (code === 'ADDITIONAL_CONSENT_REQUIRED') {
      db.update(schema.plaidItems).set({ needsInvestmentsConsent: true, modifiedAt: new Date().toISOString() })
        .where(eq(schema.plaidItems.id, item.id)).run();
    }
    if (!code || !HOLDINGS_UNAVAILABLE_CODES.has(code)) {
      // Transient/auth/unknown failure: commitSnapshot REPLACES the (account, asOf)
      // snapshot outright, so falling back here on a same-day re-sync would destroy
      // that day's good full-holdings snapshot. Bail out without touching anything.
      console.warn(`[plaid] holdings fetch failed for item ${item.id} (${code ?? err}); leaving existing snapshot untouched`);
      return { snapshots: 0, skipped: 0 };
    }
    console.warn(`[plaid] holdings unavailable for item ${item.id} (${code}); trying value-only`);
    try {
      const resp = await deps.client.accountsGet({ access_token: accessToken });
      holdingsData = { accounts: resp.data.accounts as never, holdings: [], securities: [] };
    } catch (err2) {
      console.warn(`[plaid] accountsGet also failed for item ${item.id} (${errorCode(err2) ?? err2}); skipping`);
      return { snapshots: 0, skipped: 0 };
    }
  }

  const securityById = new Map(holdingsData.securities.map((s) => [s.security_id, s]));
  const holdingsByAccount = new Map<string, typeof holdingsData.holdings>();
  for (const h of holdingsData.holdings) {
    holdingsByAccount.set(h.account_id, [...(holdingsByAccount.get(h.account_id) ?? []), h]);
  }

  for (const acct of holdingsData.accounts) {
    const local = await getAccountByPlaidId(acct.account_id, db);
    if (!local || local.accountClass !== 'investment') { skipped += 1; continue; }

    const rawHoldings = holdingsByAccount.get(acct.account_id) ?? [];
    const parsed: ParsedHolding[] = [];
    for (const h of rawHoldings) {
      const sec = securityById.get(h.security_id);
      const mapped = mapPlaidSecurity(sec ?? {});
      parsed.push({
        ticker: mapped.ticker,
        name: mapped.name,
        kind: mapped.kind,
        assetType: mapped.assetType,
        tagSource: mapped.tagSource,
        quantity: h.quantity,
        value: h.institution_value,
      });
    }

    const holdingsSum = parsed.reduce((s, h) => s + h.value, 0);
    const totalValue = acct.balances?.current ?? holdingsSum;

    try {
      try {
        await commitSnapshot({ accountId: local.id, asOf, source: 'plaid', totalValue, holdings: parsed }, db);
      } catch (err) {
        if (err instanceof ReconciliationError) {
          console.warn(`[plaid] holdings for ${local.id} do not reconcile (value ${totalValue}, holdings ${holdingsSum}); committing value-authoritative`);
          await commitSnapshot({ accountId: local.id, asOf, source: 'plaid', totalValue, holdings: parsed, acknowledgeMismatch: true }, db);
        } else {
          throw err;
        }
      }
      snapshots += 1;
    } catch (err) {
      console.warn(`[plaid] could not commit snapshot for ${local.id} (${err}); skipping account`);
      skipped += 1;
      continue;
    }
  }

  return { snapshots, skipped };
}

export async function maybeSyncInvestmentsForItem(
  itemId: string,
  deps: { client: InvestmentsSyncDeps['client']; syncInvestments?: typeof syncInvestments },
  db: Db = getDb(),
): Promise<void> {
  const hasInvestment = db.select().from(schema.accounts)
    .where(and(eq(schema.accounts.plaidItemId, itemId), eq(schema.accounts.accountClass, 'investment')))
    .get();
  if (!hasInvestment) return;
  const item = db.select().from(schema.plaidItems).where(eq(schema.plaidItems.id, itemId)).get();
  if (!item) return;
  try {
    await (deps.syncInvestments ?? syncInvestments)(item, { client: deps.client }, db);
  } catch (err) {
    console.warn(`[plaid] initial investment sync failed for item ${itemId}:`, errorCode(err) ?? String(err));
  }
}
