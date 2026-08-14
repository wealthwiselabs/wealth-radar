import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { listSnapshots } from '@/lib/investments/snapshots';
import { assembleBreakdown, type SecurityMeta, type RawTxn } from '@/lib/investments/breakdown';
import type { FlowRow } from '@/lib/investments/transfers';
import type { Purpose, PurposeOverride } from '@/lib/investments/purpose';

// GET /api/investments/breakdown?account=<id|all>&from=<YYYY-MM-DD>&to=<YYYY-MM-DD>
//
// Per-account holdings, window balance/ROI, and in-window transactions.
// Thin wrapper: all rules live in the pure assembleBreakdown helper.
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const scope = request.nextUrl.searchParams.get('account') || 'all';

    const accounts = db.select().from(schema.accounts)
      .where(eq(schema.accounts.accountClass, 'investment')).all()
      .map((a) => ({ id: a.id, name: `${a.institution} · ${a.name}`, purpose: (a.purpose ?? 'portfolio') as Purpose }));

    const overrides: PurposeOverride[] = db.select().from(schema.securityPurposes).all()
      .map((o) => ({ accountId: o.accountId, securityId: o.securityId, purpose: o.purpose as Purpose }));

    const snapshots = await listSnapshots(null, db);

    const flows: FlowRow[] = db.select().from(schema.cashFlows)
      .where(and(eq(schema.cashFlows.confirmed, true), isNull(schema.cashFlows.supersededBy))).all()
      .map((f) => ({ id: f.id, accountId: f.accountId, date: f.date, amount: f.amount, kind: f.kind, securityId: f.securityId ?? null }));

    const securities = new Map<string, SecurityMeta>(
      db.select().from(schema.securities).all().map((s) => [s.id, {
        ticker: s.ticker, name: s.name,
        assetType: s.assetType, region: s.region, cap: s.cap, style: s.style, sector: s.sector, kind: s.kind,
      }]),
    );

    const transactions: RawTxn[] = db.select().from(schema.investmentTransactions).all()
      .map((t) => ({ id: t.id, accountId: t.accountId, date: t.date, type: t.type, subtype: t.subtype, securityId: t.securityId ?? null, amount: t.amount }));

    const today = new Date().toISOString().slice(0, 10);
    const earliest = snapshots.length ? [...snapshots].map((s) => s.asOf).sort()[0] : today;
    const from = request.nextUrl.searchParams.get('from') || earliest;
    const to = request.nextUrl.searchParams.get('to') || today;
    const breakdown = assembleBreakdown({ from, to, scope, accounts, overrides, snapshots, flows, securities, transactions });
    return NextResponse.json({ breakdown, accounts });
  } catch (error) {
    console.error('Error building investment breakdown:', error);
    return NextResponse.json({ error: 'Failed to build breakdown' }, { status: 500 });
  }
}
