import { NextResponse } from 'next/server';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { netWorthAt } from '@/lib/netWorth/rollup';
import { valuationAt } from '@/lib/netWorth/valuation';
import { netWorthSide } from '@/lib/netWorth/side';
import { groupForSubtype } from '@/lib/netWorth/catalog';

// GET /api/net-worth — current totals plus one row per item for the register.
export async function GET(_request: Request) {
  try {
    const ctx = await loadNetWorthContext();
    const today = new Date().toISOString().slice(0, 10);
    const totals = netWorthAt(ctx, today);

    const rows = ctx.accounts
      .filter((a) => netWorthSide(a) !== 'excluded' && a.status !== 'closed')
      .map((a) => {
        const readings = [...ctx.balances, ...ctx.investments]
          .filter((r) => r.accountId === a.id)
          .sort((x, y) => (x.asOf < y.asOf ? 1 : -1));
        const latest = readings[0] ?? null;
        return {
          accountId: a.id,
          name: a.name,
          side: netWorthSide(a),
          group: groupForSubtype(a.subtype ?? ''),
          value: valuationAt(ctx, a.id, today),
          lastAsOf: latest?.asOf ?? null,
          source: latest?.source ?? null,
          reviewIntervalMonths: a.reviewIntervalMonths ?? null,
          securedByAccountId: a.securedByAccountId ?? null,
          valueLow: null as number | null,
          valueHigh: null as number | null,
          // Delete is offered only while nothing has been recorded; otherwise the
          // only safe removal is a close, which preserves past periods.
          canDelete: readings.length === 0,
        };
      });

    return NextResponse.json({ totals, rows });
  } catch (error) {
    console.error('Error building net worth:', error);
    return NextResponse.json({ error: 'Failed to build net worth' }, { status: 500 });
  }
}
