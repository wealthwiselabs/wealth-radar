import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { isPlaidConfigured } from '@/lib/plaid/config';
import { getPlaidClient } from '@/lib/plaid/client';
import { getDb, schema } from '@/db/client';
import { syncAllItems } from '@/lib/plaid/sync';
import { maybeSyncInvestmentsForItem } from '@/lib/plaid/syncInvestments';
import { syncInvestmentTransactions } from '@/lib/investments/investmentTransactions';
import { classifyUntaggedSecurities } from '@/lib/investments/classifySecurities';

// POST — after Plaid Link update mode succeeds (no token exchange), pull the
// item's data so a re-auth / added consent takes effect immediately.
export async function POST(request: NextRequest) {
  if (!isPlaidConfigured()) return NextResponse.json({ error: 'Plaid not configured' }, { status: 404 });
  const { itemId } = (await request.json().catch(() => ({}))) as { itemId?: string };
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
  const db = getDb();
  const item = db.select().from(schema.plaidItems).where(eq(schema.plaidItems.id, itemId)).get();
  if (!item) return NextResponse.json({ error: 'Unknown connection' }, { status: 404 });

  const client = getPlaidClient();
  try {
    await syncAllItems();
    await maybeSyncInvestmentsForItem(itemId, { client }, db);
    await syncInvestmentTransactions({ id: item.id, accessToken: item.accessToken }, { client }, db);
    await classifyUntaggedSecurities(db, { apiKey: request.headers.get('x-anthropic-api-key') ?? undefined });
  } catch (err) {
    console.warn('[plaid] reauth sync failed:', String(err));
    return NextResponse.json({ error: 'Reconnect sync failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
