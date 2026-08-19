import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { loadAccountBreakdown } from '@/lib/investments/read';

// GET /api/investments/breakdown?account=<id|all>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>
//
// Per-account holdings, window balance/ROI, and in-window transactions.
// Thin wrapper: all rules live in the pure assembleBreakdown helper.
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const scope = request.nextUrl.searchParams.get('account') || 'all';
    const from = request.nextUrl.searchParams.get('from') || undefined;
    const to = request.nextUrl.searchParams.get('to') || undefined;
    const { breakdown, accounts } = await loadAccountBreakdown(scope, from, to, db);
    return NextResponse.json({ breakdown, accounts });
  } catch (error) {
    console.error('Error building investment breakdown:', error);
    return NextResponse.json({ error: 'Failed to build breakdown' }, { status: 500 });
  }
}
