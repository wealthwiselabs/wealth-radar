import { NextResponse } from 'next/server';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { staleAccounts } from '@/lib/netWorth/staleness';

export async function GET() {
  try {
    const ctx = await loadNetWorthContext();
    return NextResponse.json({ stale: staleAccounts(ctx, new Date().toISOString().slice(0, 10)) });
  } catch (error) {
    console.error('Error listing stale accounts:', error);
    return NextResponse.json({ error: 'Failed to list stale accounts' }, { status: 500 });
  }
}
