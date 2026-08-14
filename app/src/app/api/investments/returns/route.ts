import { NextRequest, NextResponse } from 'next/server';
import { loadPortfolioContext } from '@/lib/investments/read';
import { buildValueSeries, purposeReturnBetween } from '@/lib/investments/series';
import { PURPOSES } from '@/lib/investments/purpose';

// GET /api/investments/returns?t0=YYYY-MM-DD&t1=YYYY-MM-DD
//
// Returns a value series per purpose, plus the period return for each. The
// period return is only computed when both endpoints are supplied.
export async function GET(request: NextRequest) {
  try {
    const ctx = await loadPortfolioContext();
    const t0 = request.nextUrl.searchParams.get('t0');
    const t1 = request.nextUrl.searchParams.get('t1');

    const series: Record<string, unknown> = {};
    for (const purpose of PURPOSES) {
      // The IUL's credited rate is not a market return and its surrender value
      // is not its account value, so insurance reports a balance but never a
      // return. Computing one here would put a meaningless number on screen.
      const wantsReturn = purpose !== 'insurance' && t0 !== null && t1 !== null;
      series[purpose] = {
        points: buildValueSeries(ctx.snapshots, ctx.accountPurposes, ctx.overrides, purpose),
        periodReturn: wantsReturn
          ? purposeReturnBetween(
              ctx.snapshots, ctx.accountPurposes, ctx.overrides, ctx.flows, purpose, t0!, t1!)
          : null,
      };
    }
    return NextResponse.json({ series });
  } catch (error) {
    console.error('Error computing investment returns:', error);
    return NextResponse.json({ error: 'Failed to compute returns' }, { status: 500 });
  }
}
