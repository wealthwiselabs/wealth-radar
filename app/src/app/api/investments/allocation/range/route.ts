import { NextRequest, NextResponse } from 'next/server';
import { loadAllocationContext } from '@/lib/investments/read';
import { buildAllocationWindowTree, earliestSnapshotDate } from '@/lib/investments/allocation';

// GET /api/investments/allocation/range?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Allocation tree over an explicit window (start balance, end balance, ROI).
// An empty `from` means "since the earliest snapshot"; an empty `to` means today.
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    const ctx = await loadAllocationContext();
    const today = new Date().toISOString().slice(0, 10);
    const from = q.get('from') || earliestSnapshotDate(ctx, today);
    const to = q.get('to') || today;
    return NextResponse.json({ tree: buildAllocationWindowTree(ctx, from, to), from, to });
  } catch (error) {
    console.error('Error building range allocation:', error);
    return NextResponse.json({ error: 'Failed to build allocation' }, { status: 500 });
  }
}
