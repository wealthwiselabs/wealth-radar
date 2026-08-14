import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db/client';
import { eq } from 'drizzle-orm';
import { snapshotDb } from '@/lib/backup';
import { deleteAccountData } from '@/lib/accountRemoval';
import { suppressPlaidAccount } from '@/lib/plaidSuppression';

interface RouteContext { params: Promise<{ id: string }>; }

// POST — hard-delete one account and all its data. Snapshots the DB first.
// For a Plaid account whose Item stays connected, record a suppression first so the
// next sync does not re-provision the row and bring the account back.
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const db = getDb();
  snapshotDb('pre-account-remove');
  const acct = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
  if (!acct) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  suppressPlaidAccount(acct, db);
  const res = deleteAccountData(id, db);
  if (!res.deleted) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  return NextResponse.json({ removed: true });
}
