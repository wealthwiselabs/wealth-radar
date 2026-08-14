import { NextRequest, NextResponse } from 'next/server';
import { loadAllocationContext } from '@/lib/investments/read';
import { nodeTrendSeries } from '@/lib/investments/allocation';
import { type AllocationBasis } from '@/lib/investments/periods';

// GET /api/investments/allocation/trend?basis=monthly|quarterly|yearly&path=a/b/c&from=&to=
//
// Returns a trend series for the selected node. Each point carries both value and roi,
// allowing the client chart to select the metric to display (no server metric param).
// Empty `from`/`to` resolve to the earliest snapshot / today, same as B2's range route.
// Response: { points }
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    const basis = (['monthly','quarterly','yearly'].includes(q.get('basis') ?? '') ? q.get('basis') : 'quarterly') as AllocationBasis;
    const path = (q.get('path') ?? '').split('/').filter(Boolean);
    const ctx = await loadAllocationContext();
    const earliest = ctx.snapshots.length ? ctx.snapshots.map((s) => s.asOf).sort()[0] : null;
    const today = new Date().toISOString().slice(0, 10);
    const from = q.get('from') || earliest || today;
    const to = q.get('to') || today;
    // Same trailing-months defect and fix as purpose-trend: drop periods that
    // haven't started yet (startDate <= today), not periods whose endDate is
    // in the future — see purpose-trend/route.ts for why clamping `to` is wrong.
    const points = earliest
      ? nodeTrendSeries(ctx, path, basis, from, to).filter((p) => p.startDate <= today)
      : [];
    return NextResponse.json({ points });
  } catch (error) {
    console.error('Error building allocation trend:', error);
    return NextResponse.json({ error: 'Failed to build trend' }, { status: 500 });
  }
}
