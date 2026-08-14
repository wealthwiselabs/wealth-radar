export interface RawTxnForDerive {
  type: string;
  subtype: string | null;
  amount: number; // Plaid sign: + = cash debited/out of account
  name?: string;  // Plaid transaction name; used to detect internal (non-cash) legs
}

export type FlowKind = 'contribution' | 'withdrawal' | 'transfer_in' | 'transfer_out';

export interface DerivedFlow {
  kind: FlowKind;
  amount: number; // our sign: + into account, − out
  confirmed: boolean;
}

/**
 * Map a raw Plaid investment transaction to an external cash flow, or null when
 * it isn't external cash (buys/sells/dividends/interest/fees belong in the
 * return, not as a contribution). Our amount negates Plaid's opposite sign.
 * Explicit contribution/withdrawal subtypes are confirmed; ambiguous transfers
 * are left unconfirmed so they stay out of ROI until a human accepts them.
 */
export function deriveCashFlow(txn: RawTxnForDerive): DerivedFlow | null {
  // Internal accounting legs (realized gain/loss from an in-plan fund rebalance)
  // are tagged by Plaid as deposit/withdrawal but move no external cash. Drop them.
  if (/realizedgainloss/i.test(txn.name ?? '')) return null;
  const sub = (txn.subtype ?? '').toLowerCase();
  const amount = -txn.amount; // Plaid → our sign
  if (amount === 0) return null; // no cash moved (e.g. 0.00 transferOut rebalance legs)

  if (sub === 'contribution' || sub === 'deposit') {
    return { kind: 'contribution', amount, confirmed: true };
  }
  if (sub === 'withdrawal' || sub === 'distribution') {
    return { kind: 'withdrawal', amount, confirmed: true };
  }
  if (txn.type === 'transfer' || sub === 'transfer') {
    return { kind: amount >= 0 ? 'transfer_in' : 'transfer_out', amount, confirmed: false };
  }
  return null;
}

import type { PlaidApi } from 'plaid';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { decryptToken } from '@/lib/crypto';
import { getAccountByPlaidId } from '@/lib/accounts';
import { resolveOrCreateSecurity } from '@/lib/investments/securities';
import { mapPlaidSecurity } from '@/lib/plaid/mapSecurity';

type Db = ReturnType<typeof getDb>;

export interface InvestmentTxnSyncDeps {
  client: Pick<PlaidApi, 'investmentsTransactionsGet'>;
  /** Page size for pagination (default 500, Plaid's max). Overridable for tests. */
  pageSize?: number;
}

interface PlaidInvTxn {
  investment_transaction_id: string;
  account_id: string;
  security_id: string | null;
  date: string;
  name: string;
  amount: number;
  quantity: number | null;
  price: number | null;
  fees: number | null;
  type: string;
  subtype: string | null;
}

interface PlaidSec { security_id: string; ticker_symbol?: string | null; name?: string | null; type?: string | null }

/** True if the account already has statement-sourced history — statements own its flows. */
function isStatementCovered(accountId: string, db: Db): boolean {
  return db.select().from(schema.investmentSnapshots).all()
    .some((s) => s.accountId === accountId && s.source === 'statement');
}

/** Date string N months before `today` (YYYY-MM-DD). */
function monthsBefore(today: string, months: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * Pull one item's Plaid investment transactions (trailing ~24 months), upsert
 * the raw rows (dedup by plaidInvestmentTxnId), and insert derived external
 * cash flows. Never throws: a Plaid failure returns zeros with nothing written.
 */
export async function syncInvestmentTransactions(
  item: { id: string; accessToken: string },
  deps: InvestmentTxnSyncDeps,
  db: Db = getDb(),
): Promise<{ transactions: number; flows: number }> {
  let accessToken: string;
  try {
    accessToken = decryptToken(item.accessToken);
  } catch {
    console.warn(`[plaid] could not decrypt access token for item ${item.id}; skipping txns`);
    return { transactions: 0, flows: 0 };
  }

  const today = new Date().toISOString().slice(0, 10);
  const startDate = monthsBefore(today, 24);
  const pageSize = deps.pageSize ?? 500;

  const all: PlaidInvTxn[] = [];
  const securities = new Map<string, PlaidSec>();
  try {
    let offset = 0;
    for (;;) {
      const resp = await deps.client.investmentsTransactionsGet({
        access_token: accessToken,
        start_date: startDate,
        end_date: today,
        options: { count: pageSize, offset },
      });
      const data = resp.data as unknown as {
        investment_transactions: PlaidInvTxn[]; securities: PlaidSec[]; total_investment_transactions: number;
      };
      for (const s of data.securities ?? []) securities.set(s.security_id, s);
      all.push(...(data.investment_transactions ?? []));
      offset += pageSize;
      if (offset >= (data.total_investment_transactions ?? all.length) || (data.investment_transactions ?? []).length === 0) break;
    }
  } catch (err) {
    console.warn(`[plaid] investment transactions fetch failed for item ${item.id} (${String(err)}); leaving existing data untouched`);
    return { transactions: 0, flows: 0 };
  }

  const now = new Date().toISOString();
  let transactions = 0, flows = 0;

  for (const t of all) {
    const local = await getAccountByPlaidId(t.account_id, db);
    if (!local || local.accountClass !== 'investment') continue;

    // Resolve the security (if any) so a txn-only security still gets created
    // (and tagged later by classifyUntaggedSecurities).
    let securityId: string | null = null;
    if (t.security_id) {
      const sec = securities.get(t.security_id);
      const resolved = await resolveOrCreateSecurity(mapPlaidSecurity(sec ?? {}), db);
      securityId = resolved.id;
    }

    // Upsert raw by plaidInvestmentTxnId (raw rows never change → insert if absent).
    let rawRow = db.select().from(schema.investmentTransactions)
      .where(eq(schema.investmentTransactions.plaidInvestmentTxnId, t.investment_transaction_id)).get();
    if (!rawRow) {
      const id = crypto.randomUUID();
      db.insert(schema.investmentTransactions).values({
        id, accountId: local.id, plaidInvestmentTxnId: t.investment_transaction_id, securityId,
        date: t.date, name: t.name ?? '', amount: t.amount ?? 0,
        quantity: t.quantity ?? null, price: t.price ?? null, fees: t.fees ?? null,
        type: t.type ?? '', subtype: t.subtype ?? null, createdAt: now, modifiedAt: now,
      }).run();
      rawRow = db.select().from(schema.investmentTransactions).where(eq(schema.investmentTransactions.id, id)).get()!;
    }
    transactions += 1;

    // Statements are authoritative for their accounts: don't derive Plaid flows
    // there (they'd double-count / reintroduce pollution). Raw txns still stored above.
    if (isStatementCovered(local.id, db)) continue;

    // Derive a flow and insert only if none already references this raw row.
    const derived = deriveCashFlow({ type: t.type, subtype: t.subtype, amount: t.amount, name: t.name });
    if (!derived) continue;
    const existingFlow = db.select().from(schema.cashFlows)
      .where(eq(schema.cashFlows.sourceRef, rawRow.id)).get();
    if (existingFlow) continue;
    db.insert(schema.cashFlows).values({
      id: crypto.randomUUID(), accountId: local.id, securityId: null, date: t.date,
      amount: derived.amount, kind: derived.kind, source: 'plaid', confirmed: derived.confirmed,
      sourceRef: rawRow.id, note: '', createdAt: now, modifiedAt: now,
    }).run();
    flows += 1;
  }

  return { transactions, flows };
}
