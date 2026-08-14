import { NextRequest, NextResponse } from 'next/server';
import { loadAllocationContext } from '@/lib/investments/read';
import { nodeTrendSeries, buildAllocationWindowTree } from '@/lib/investments/allocation';
import type { AllocationBasis } from '@/lib/investments/periods';
import { PURPOSES, type Purpose } from '@/lib/investments/purpose';

// GET /api/investments/purpose-trend?purposes=portfolio,reserve&basis=monthly&from=&to=
//
// Per-period value/ROI/gain for a set of purposes, plus one overall figure for
// the whole window. Serves the reserve chart and the homepage return line.
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams;
    const raw = (q.get('purposes') ?? 'portfolio').split(',').map((s) => s.trim()).filter(Boolean);
    const invalid = raw.filter((p) => !(PURPOSES as readonly string[]).includes(p));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `invalid purpose(s): ${invalid.join(', ')} (use ${PURPOSES.join('|')})` }, { status: 400 });
    }
    const targets = (raw.length > 0 ? raw : ['portfolio']) as Purpose[];
    const basis = (['monthly', 'quarterly', 'yearly'].includes(q.get('basis') ?? '')
      ? q.get('basis') : 'monthly') as AllocationBasis;

    const ctx = await loadAllocationContext();
    const earliest = ctx.snapshots.length ? ctx.snapshots.map((s) => s.asOf).sort()[0] : null;
    const today = new Date().toISOString().slice(0, 10);
    const from = q.get('from') || earliest || today;
    const to = q.get('to') || today;

    // Drop periods that haven't started yet (e.g. Sep-Dec under a This-Year
    // window in August) so the chart doesn't draw empty trailing months. Filter
    // on startDate, not `to`: clamping `to` to today would also delete the
    // current, in-progress period (August ends 2026-08-31, in the future).
    // `overall` is left alone — it's a single carry-forward window figure, not
    // a per-period series, so it isn't subject to this trailing-months defect.
    const points = nodeTrendSeries(ctx, [], basis, from, to, targets)
      .filter((p) => p.startDate <= today);
    const window = buildAllocationWindowTree(ctx, from, to, targets);
    return NextResponse.json({
      points,
      overall: {
        roi: window.roi.kind === 'ok' ? window.roi.value : null,
        gain: window.gain,
        startValue: window.startBalance,
        endValue: window.balance,
        // Coverage disclosure — a caller (e.g. the reserve page's tile) must
        // be able to tell a partial total (some accounts excluded from the
        // sum) from a complete one, rather than render endValue as if it
        // were the whole household figure. accountsMissing alone only names
        // accounts that BRACKET the window and skip it — it says nothing
        // about an account whose whole history starts after `from` (the
        // common shape under an empty `from`, which resolves to the global
        // earliest snapshot across every account, not just this purpose's).
        // accountsInWindow (any snapshot within [from, to], regardless of
        // root eligibility) lets a caller catch that case too: accountsCounted
        // < accountsInWindow means someone who reported during the window was
        // silently dropped from endValue.
        accountsCounted: window.accountsCounted ?? 0,
        accountsMissing: window.accountsMissing ?? [],
        accountsInWindow: window.accountsInWindow ?? 0,
      },
      from, to,
    });
  } catch (error) {
    console.error('Error building purpose trend:', error);
    return NextResponse.json({ error: 'Failed to build purpose trend' }, { status: 500 });
  }
}
