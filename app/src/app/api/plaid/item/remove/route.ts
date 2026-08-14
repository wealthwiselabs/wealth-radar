import { NextRequest, NextResponse } from 'next/server';
import { isPlaidConfigured } from '@/lib/plaid/config';
import { getPlaidClient } from '@/lib/plaid/client';
import { snapshotDb } from '@/lib/backup';
import { removeItem } from '@/lib/accountRemoval';

// POST — disconnect a Plaid connection (itemRemove + delete its accounts). Snapshots first.
export async function POST(request: NextRequest) {
  if (!isPlaidConfigured()) return NextResponse.json({ error: 'Plaid not configured' }, { status: 404 });
  const { itemId } = (await request.json().catch(() => ({}))) as { itemId?: string };
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 });
  snapshotDb('pre-item-remove');
  const res = await removeItem(itemId, { client: getPlaidClient() });
  if (!res.removed) return NextResponse.json({ error: 'Unknown connection' }, { status: 404 });
  return NextResponse.json(res);
}
