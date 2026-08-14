import { NextResponse } from 'next/server';
import { isPlaidConfigured } from '@/lib/plaid/config';
import { getDb, schema } from '@/db/client';

export async function GET() {
  if (!isPlaidConfigured()) return NextResponse.json({ error: 'Plaid not configured' }, { status: 404 });
  const db = getDb();
  const items = db.select({
    id: schema.plaidItems.id, institutionName: schema.plaidItems.institutionName,
    owner: schema.plaidItems.owner, status: schema.plaidItems.status,
    error: schema.plaidItems.error, needsInvestmentsConsent: schema.plaidItems.needsInvestmentsConsent,
    lastSyncedAt: schema.plaidItems.lastSyncedAt,
  }).from(schema.plaidItems).all();
  return NextResponse.json({ items });
}
