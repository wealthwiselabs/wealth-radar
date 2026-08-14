import { NextRequest, NextResponse } from 'next/server';
import { loadAllocationContext } from '@/lib/investments/read';
import { buildAllocationTree } from '@/lib/investments/allocation';
import { enumerateAllocationPeriods, type AllocationBasis } from '@/lib/investments/periods';

// GET /api/investments/allocation?basis=monthly|quarterly|yearly&period=<key>
//
// Returns the allocation tree for the selected period, plus the period itself and
// available periods. Response: { tree, selected, periods }
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    const basis = (['monthly','quarterly','yearly'].includes(q.get('basis') ?? '') ? q.get('basis') : 'quarterly') as AllocationBasis;
    const ctx = await loadAllocationContext();
    const earliest = ctx.snapshots.length ? ctx.snapshots.map((s) => s.asOf).sort()[0] : null;
    const today = new Date().toISOString().slice(0, 10);
    const periods = earliest ? enumerateAllocationPeriods(earliest, today, basis) : [];
    const requested = periods.find((p) => p.key === q.get('period'));
    // No explicit (matching) period param: default to the latest period that
    // actually has data, not the latest calendar period — the newest period is
    // often still in progress (no snapshots yet), which would otherwise load
    // straight into an empty "No allocation data" state.
    let selected = requested;
    let tree = requested ? buildAllocationTree(ctx, requested) : null;
    if (!requested) {
      for (let i = periods.length - 1; i >= 0; i--) {
        const candidate = buildAllocationTree(ctx, periods[i]);
        if (candidate.children.length > 0 || candidate.roi.kind === 'ok') {
          selected = periods[i];
          tree = candidate;
          break;
        }
      }
      if (!selected && periods.length > 0) {
        selected = periods[periods.length - 1];
        tree = buildAllocationTree(ctx, selected);
      }
    }
    return NextResponse.json({ tree, selected: selected?.key ?? null, periods: periods.map((p) => ({ key: p.key, label: p.label })) });
  } catch (error) {
    console.error('Error building allocation tree:', error);
    return NextResponse.json({ error: 'Failed to build allocation' }, { status: 500 });
  }
}
