import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { accounts, balanceSnapshots } from '@/db/schema';
import { getValuationProvider } from '@/lib/netWorth/providers';
import { upsertBalanceSnapshot } from '@/lib/netWorth/write';

export async function POST(request: NextRequest) {
  const db = getDb();
  try {
    const { accountId } = await request.json() as { accountId?: string };
    if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });

    const provider = getValuationProvider();
    if (!provider) {
      return NextResponse.json(
        { error: 'No valuation provider is configured. Set RENTCAST_API_KEY to enable this.' },
        { status: 404 });
    }

    const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account?.valuationRef) {
      return NextResponse.json({ error: 'This item has no address to look up.' }, { status: 400 });
    }
    if (!provider.supports(account.subtype ?? '')) {
      return NextResponse.json({ error: 'This provider cannot value this kind of item.' }, { status: 400 });
    }

    // Rate guard, checked BEFORE the call. Free tiers are small, and this guard
    // is the only thing between a refresh loop and a burned monthly quota.
    // Blocks on ANY same-day row, not just a prior estimate: upsertBalanceSnapshot
    // is guaranteed to discard an estimate over a same-day manual entry, so
    // calling the provider in that case would burn a request for a result that
    // can never be written.
    const today = new Date().toISOString().slice(0, 10);
    const already = db.select().from(balanceSnapshots)
      .where(and(eq(balanceSnapshots.accountId, accountId), eq(balanceSnapshots.asOf, today)))
      .get();
    if (already) {
      const message = already.source === 'manual'
        ? 'This item has a manual value entered today — an estimate would be discarded, so none was requested.'
        : 'Already refreshed today.';
      return NextResponse.json({ error: message }, { status: 409 });
    }

    let estimate;
    try {
      estimate = await provider.estimate(account.valuationRef);
    } catch (err) {
      // Deliberately write nothing. The item stays in the stale list rather than
      // showing a carried-forward value as if it had just been refreshed.
      console.error('Valuation provider failed:', err);
      return NextResponse.json({ error: 'The valuation service did not respond.' }, { status: 502 });
    }

    // upsertBalanceSnapshot itself refuses to replace a same-day manual row.
    await upsertBalanceSnapshot({
      accountId, asOf: today, balance: estimate.value, source: 'estimate',
      valueLow: estimate.low, valueHigh: estimate.high,
    }, db);

    return NextResponse.json({ ok: true, ...estimate });
  } catch (error) {
    console.error('Error refreshing estimate:', error);
    return NextResponse.json({ error: 'Failed to refresh the estimate' }, { status: 500 });
  }
}
