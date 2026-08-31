import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { balanceSnapshots } from '@/db/schema';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { netWorthAt } from '@/lib/netWorth/rollup';
import { valuationAt } from '@/lib/netWorth/valuation';
import { netWorthSide } from '@/lib/netWorth/side';
import { groupForSubtype } from '@/lib/netWorth/catalog';
import { getValuationProvider } from '@/lib/netWorth/providers';

// GET /api/net-worth — current totals plus one row per item for the register.
export async function GET(_request: Request) {
  try {
    const ctx = await loadNetWorthContext();
    const today = new Date().toISOString().slice(0, 10);
    const totals = netWorthAt(ctx, today);

    // The merged Reading shape in read.ts (used for balances + investments)
    // strips valueLow/valueHigh, since only balance_snapshots carries a range.
    // Look those columns up directly, keyed by (accountId, asOf), rather than
    // widening that shared type for one column pair only property rows use.
    const rangeByAccountAndAsOf = new Map<string, { low: number | null; high: number | null }>();
    for (const s of getDb().select().from(balanceSnapshots).all()) {
      rangeByAccountAndAsOf.set(`${s.accountId}::${s.asOf}`, { low: s.valueLow, high: s.valueHigh });
    }

    const rows = ctx.accounts
      .filter((a) => netWorthSide(a) !== 'excluded' && a.status !== 'closed')
      .map((a) => {
        const readings = [...ctx.balances, ...ctx.investments]
          .filter((r) => r.accountId === a.id)
          .sort((x, y) => (x.asOf < y.asOf ? 1 : -1));
        const latest = readings[0] ?? null;
        const range = latest ? rangeByAccountAndAsOf.get(`${a.id}::${latest.asOf}`) : null;
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
          valueLow: range?.low ?? null,
          valueHigh: range?.high ?? null,
          valuationRef: a.valuationRef ?? null,
          // Delete is offered only while nothing has been recorded; otherwise the
          // only safe removal is a close, which preserves past periods.
          canDelete: readings.length === 0,
        };
      });

    // The register can't offer (or hide) estimate UI on its own — it has no way
    // to know whether RENTCAST_API_KEY is set server-side. Told explicitly here
    // so the client can honour "never mention estimates" when it is not.
    return NextResponse.json({ totals, rows, providerConfigured: getValuationProvider() !== null });
  } catch (error) {
    console.error('Error building net worth:', error);
    return NextResponse.json({ error: 'Failed to build net worth' }, { status: 500 });
  }
}
