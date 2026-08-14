import { NextResponse } from 'next/server';
import { isPlaidConfigured } from '@/lib/plaid/config';
import { syncAllItems } from '@/lib/plaid/sync';

export async function POST() {
  if (!isPlaidConfigured()) return NextResponse.json({ error: 'Plaid not configured' }, { status: 404 });
  try {
    const res = await syncAllItems();
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ error: 'Sync failed', details: String(err) }, { status: 500 });
  }
}
