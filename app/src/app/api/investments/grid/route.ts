import { NextRequest, NextResponse } from 'next/server';
import { loadGridContext } from '@/lib/investments/read';
import { buildReturnsGrid } from '@/lib/investments/grid';
import { rangeToDates, type PeriodBasis } from '@/lib/investments/periods';
import { PURPOSES, type Purpose } from '@/lib/investments/purpose';

// GET /api/investments/grid?basis=monthly|quarterly&range=8|all&purpose=portfolio|reserve
export async function GET(request: NextRequest) {
  try {
    const q = new URL(request.url).searchParams;
    const basis: PeriodBasis = q.get('basis') === 'monthly' ? 'monthly' : 'quarterly';
    const rangeParam = q.get('range');
    const range: number | 'all' = rangeParam === 'all'
      ? 'all'
      : Number(rangeParam) || (basis === 'quarterly' ? 8 : 12);
    const requested = q.get('purpose') ?? '';
    const target = ((PURPOSES as readonly string[]).includes(requested) ? requested : 'portfolio') as Purpose;

    const ctx = await loadGridContext();
    const earliest = ctx.snapshots.length
      ? ctx.snapshots.map((s) => s.asOf).sort()[0] : null;
    const today = new Date().toISOString().slice(0, 10);
    // An explicit from/to window (both required) wins; otherwise derive from range.
    const fromParam = q.get('from');
    const toParam = q.get('to');
    const { from, to } = fromParam && toParam
      ? { from: fromParam, to: toParam }
      : rangeToDates(basis, range, earliest, today);

    const grid = buildReturnsGrid(ctx, { basis, from, to, target });
    return NextResponse.json({ grid, from, to });
  } catch (error) {
    console.error('Error building investment returns grid:', error);
    return NextResponse.json({ error: 'Failed to build returns grid' }, { status: 500 });
  }
}
