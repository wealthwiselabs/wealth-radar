import { NextRequest, NextResponse } from 'next/server';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { netWorthSeries } from '@/lib/netWorth/rollup';
import type { AllocationBasis } from '@/lib/investments/periods';

export async function GET(request: NextRequest) {
  try {
    const q = new URL(request.url).searchParams;
    const basis = (['monthly', 'quarterly', 'yearly'].includes(q.get('basis') ?? '')
      ? q.get('basis') : 'monthly') as AllocationBasis;
    const today = new Date().toISOString().slice(0, 10);
    const ctx = await loadNetWorthContext();
    const earliest = [...ctx.balances, ...ctx.investments].map((r) => r.asOf).sort()[0] ?? today;
    const from = q.get('from') || earliest;
    const to = q.get('to') || today;
    return NextResponse.json({ points: netWorthSeries(ctx, from, to, basis).filter((p) => p.date <= today) });
  } catch (error) {
    console.error('Error building net worth series:', error);
    return NextResponse.json({ error: 'Failed to build net worth series' }, { status: 500 });
  }
}
