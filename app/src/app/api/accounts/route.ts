import { NextResponse } from 'next/server';
import { isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';

// GET /api/accounts - list all accounts with per-account transaction count
//
// NOTE: per-account counts are computed via a separate GROUP BY query rather
// than a correlated subquery (`select count(*) from transactions t where
// t.account_id = accounts.id`). drizzle renders an interpolated column that
// shares its outer select-list alias (`id`) as the bare identifier "id" rather
// than a table-qualified "accounts"."id" (see .toSQL() output). Since
// `transactions` also has its own `id` primary key column, SQLite resolves
// the unqualified "id" inside the subquery to the *inner* scope (t.id) rather
// than the outer accounts.id, so the correlated subquery silently always
// compares t.account_id to t.id and returns 0 for every account. Verified
// against the real dev DB (613 real transactions, correlated-subquery version
// returned txnCount: 0 for all 21 accounts).
export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .select({
        id: schema.accounts.id,
        institution: schema.accounts.institution,
        name: schema.accounts.name,
        owner: schema.accounts.owner,
        mask: schema.accounts.mask,
        nameSource: schema.accounts.nameSource,
        accountClass: schema.accounts.accountClass,
        status: schema.accounts.status,
        closedAtMonth: schema.accounts.closedAtMonth,
      })
      .from(schema.accounts)
      .all();

    const counts = db
      .select({
        accountId: schema.transactions.accountId,
        count: sql<number>`count(*)`,
      })
      .from(schema.transactions)
      .where(isNull(schema.transactions.supersededBy))
      .groupBy(schema.transactions.accountId)
      .all();
    const countMap = new Map(counts.map((c) => [c.accountId, c.count]));

    const accounts = rows
      .map((r) => ({
        ...r,
        txnCount: countMap.get(r.id) ?? 0,
        // Chase reports every card as "CREDIT CARD"; those land as the generic
        // label and need a human to name them.
        needsName: r.nameSource === 'derived' && (r.name === 'Card' || r.name === 'Account'),
      }))
      .sort((a, b) =>
        (a.owner + a.institution + a.name).localeCompare(b.owner + b.institution + b.name));

    return NextResponse.json({ accounts });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
  }
}
