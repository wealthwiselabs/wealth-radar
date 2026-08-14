import type { PlaidApi, Transaction } from 'plaid';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { decryptToken } from '@/lib/crypto';
import { mapPlaidAccount } from '@/lib/plaid/mapAccount';
import { getAccountByPlaidId, resolveOrCreateAccount } from '@/lib/accounts';
import { listSuppressedPlaidAccountIds } from '@/lib/plaidSuppression';
import { transactionFingerprint } from '@/lib/fingerprint';
import { ingestClassifiedBatch } from '@/lib/ingest';
import { classifyTransactions } from '@/lib/classify';
import { monthOf, recomputeMonthlyAggregates } from '@/lib/aggregates';
import { getPlaidClient } from '@/lib/plaid/client';
import { snapshotDb } from '@/lib/backup';
import { syncInvestments as defaultSyncInvestments } from '@/lib/plaid/syncInvestments';

type Db = ReturnType<typeof getDb>;
type ItemRow = typeof schema.plaidItems.$inferSelect;
interface SyncDeps {
  client: PlaidApi;
  classify: typeof classifyTransactions;
  syncInvestments?: typeof defaultSyncInvestments;
}

function groupByAccount(txns: Transaction[]): Map<string, Transaction[]> {
  const byAcct = new Map<string, Transaction[]>();
  for (const t of txns) {
    const list = byAcct.get(t.account_id);
    if (list) list.push(t);
    else byAcct.set(t.account_id, [t]);
  }
  return byAcct;
}

export async function syncItem(item: ItemRow, deps: SyncDeps, db: Db = getDb()) {
  const now = new Date().toISOString();
  // Running totals live in the outer scope so a mid-sync failure can still report
  // the counts from pages that already committed (threaded into finishError).
  let added = 0, skipped = 0;

  // The ENTIRE body — starting with decryptToken — is wrapped so that ANY throw
  // (bad token, network error, Plaid error) routes to finishError, which flips the
  // item's status to error/login_required. This keeps a single bad item isolated:
  // it never escapes syncItem to abort the rest of syncAllItems's loop.
  try {
    const accessToken = decryptToken(item.accessToken);

    // Ensure accounts exist (idempotent) so transactions map to the right account.
    // Accounts the user individually removed (while keeping the Item) are suppressed:
    // skip provisioning them, or they'd silently reappear on every sync. Their
    // transactions are skipped too — getAccountByPlaidId below returns null for them,
    // so the added/modified loop's `if (!account) continue` drops them.
    const suppressed = listSuppressedPlaidAccountIds(db);
    const acctResp = await deps.client.accountsGet({ access_token: accessToken });
    for (const a of acctResp.data.accounts) {
      if (suppressed.has(a.account_id)) continue;
      await resolveOrCreateAccount({ ...mapPlaidAccount(a, item.institutionName ?? 'Bank', item.owner), plaidItemId: item.id }, db);
    }

    let cursor = item.cursor ?? undefined;
    let syncedThrough = item.syncedThroughMonth ?? '';

    let hasMore = true;
    while (hasMore) {
      const resp = await deps.client.transactionsSync({ access_token: accessToken, cursor });
      const data = resp.data;

      // "accountId|month" pairs whose aggregates must be recomputed because of
      // in-place modifications or removals on this page. (Inserts are handled by
      // ingestClassifiedBatch, which recomputes the inserted rows' months itself.)
      const affected = new Set<string>();

      const addedByAcct = groupByAccount(data.added);
      const modifiedByAcct = groupByAccount(data.modified);

      const acctIds = new Set<string>([...addedByAcct.keys(), ...modifiedByAcct.keys()]);
      for (const plaidAccountId of acctIds) {
        const account = await getAccountByPlaidId(plaidAccountId, db);
        if (!account) continue;

        // Transactions to insert: everything from `added`, plus any `modified`
        // whose row we've never seen (treat as a fresh insert).
        const toInsert: Transaction[] = [...(addedByAcct.get(plaidAccountId) ?? [])];

        // MODIFIED: update the stored row in place (pending→posted, amount fixes,
        // etc.). Keep the existing categoryId/subcategoryId so a manual re-category
        // survives. If no row exists yet, fall back to inserting it as `added`.
        for (const t of modifiedByAcct.get(plaidAccountId) ?? []) {
          const existing = db.select().from(schema.transactions)
            .where(and(
              eq(schema.transactions.accountId, account.id),
              eq(schema.transactions.externalId, t.transaction_id),
            )).get();
          if (!existing) { toInsert.push(t); continue; }
          const newMonth = monthOf(t.date);
          db.update(schema.transactions).set({
            amount: -t.amount, pending: t.pending, date: t.date, month: newMonth,
            description: t.name, plaidCategory: t.personal_finance_category?.primary ?? null,
            fingerprint: transactionFingerprint({ accountId: account.id, date: t.date, description: t.name, amount: -t.amount }),
            modifiedAt: now,
          }).where(eq(schema.transactions.id, existing.id)).run();
          affected.add(`${account.id}|${existing.month}`);
          affected.add(`${account.id}|${newMonth}`);
        }

        if (toInsert.length) {
          const cats = await deps.classify(
            toInsert.map((t) => ({ description: t.name, amount: -t.amount, accountType: account.type, plaidCategory: t.personal_finance_category?.primary ?? null })),
            { db },
          );
          const res = await ingestClassifiedBatch({
            account: { institution: account.institution, name: account.name, owner: account.owner, plaidAccountId, origin: 'plaid' },
            source: 'plaid', sourceFile: null,
            transactions: toInsert.map((t, i) => ({
              date: t.date, description: t.name, amount: -t.amount,   // flip: Plaid + = money out → expense
              categoryId: cats[i].categoryId, subcategoryId: cats[i].subcategoryId,
              externalId: t.transaction_id, plaidCategory: t.personal_finance_category?.primary ?? null,
              pending: t.pending,
            })),
          }, db);
          added += res.added; skipped += res.skipped;
          for (const t of toInsert) { const m = monthOf(t.date); if (m > syncedThrough) syncedThrough = m; }
        }
      }

      // REMOVED: capture each row's (accountId, month) before deleting so we can
      // recompute the aggregates it contributed to.
      for (const r of data.removed) {
        if (!r.transaction_id) continue;
        const existing = db.select().from(schema.transactions)
          .where(eq(schema.transactions.externalId, r.transaction_id)).get();
        if (!existing) continue;
        db.delete(schema.transactions).where(eq(schema.transactions.externalId, r.transaction_id)).run();
        affected.add(`${existing.accountId}|${existing.month}`);
      }

      for (const key of affected) {
        const [accountId, month] = key.split('|');
        recomputeMonthlyAggregates(accountId, month, db);
      }

      cursor = data.next_cursor;
      hasMore = data.has_more;
    }

    // syncedThroughMonth means "this item's history has been pulled through month X" —
    // a property of the SYNC COMPLETING, not of what it happened to insert. Deriving it
    // solely from `toInsert` (above) breaks the moment a sync inserts nothing: e.g. a
    // Plaid-connected account whose history was already present because the user merged
    // in PDF-statement transactions first — Plaid's `added` page dedupes entirely
    // (added: 0), syncedThrough never advances, and it gets written back as NULL, so
    // coverage.ts reports every month as "not synced yet" despite a clean sync. A
    // newly-issued card with zero transactions is likewise fully synced, not un-synced.
    // So on a successful completion we advance to the later of the existing mark and the
    // current month regardless of insert count. Do NOT "simplify" this back to deriving
    // purely from inserted rows.
    const completedThroughMonth = now.slice(0, 7);
    if (completedThroughMonth > syncedThrough) syncedThrough = completedThroughMonth;

    db.update(schema.plaidItems).set({
      cursor: cursor ?? null, status: 'healthy', error: null,
      syncedThroughMonth: syncedThrough, lastSyncedAt: now, modifiedAt: now,
    }).where(eq(schema.plaidItems.id, item.id)).run();

    return { added, skipped, status: 'healthy' as const };
  } catch (err: unknown) {
    return finishError(db, item, err, now, added, skipped);
  }
}

function finishError(db: Db, item: ItemRow, err: unknown, now: string, added = 0, skipped = 0) {
  const code = (err as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
  const status = code === 'ITEM_LOGIN_REQUIRED' ? 'login_required' : 'error';
  db.update(schema.plaidItems).set({
    status, error: JSON.stringify(code ?? String(err)).slice(0, 500), modifiedAt: now,
  }).where(eq(schema.plaidItems.id, item.id)).run();
  return { added, skipped, status };
}

export async function syncAllItems(db: Db = getDb(), deps?: SyncDeps) {
  const resolved: SyncDeps = deps ?? { client: getPlaidClient(), classify: classifyTransactions };

  // Undo point before anything destructive: a sync can delete rows outright
  // (Plaid `removed`) and overwrite them in place (`modified`), taking the
  // user's manual categorizations with them. snapshotDb never throws — a
  // backup problem must not stop the sync.
  snapshotDb('pre-sync', { db });

  const items = db.select().from(schema.plaidItems).all();
  let added = 0;
  for (const item of items) {
    // Belt-and-suspenders: syncItem already routes its own failures to finishError,
    // but guard here too so one item can never abort the loop over the rest.
    try {
      added += (await syncItem(item, resolved, db)).added;
    } catch {
      // Item status was already set by syncItem's finishError; move on.
    }

    // Additive: pull holdings for any item that owns an investment account.
    const hasInvestment = db.select().from(schema.accounts)
      .where(and(eq(schema.accounts.plaidItemId, item.id), eq(schema.accounts.accountClass, 'investment')))
      .get();
    if (hasInvestment) {
      try {
        await (resolved.syncInvestments ?? defaultSyncInvestments)(item, { client: resolved.client }, db);
      } catch (err) {
        console.warn(`[plaid] investment sync failed for item ${item.id}:`, String(err));
      }
    }
  }
  return { items: items.length, added };
}
