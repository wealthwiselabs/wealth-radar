import { NextRequest, NextResponse } from 'next/server';
import { upsertBalanceSnapshot } from '@/lib/netWorth/write';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      accountId?: string; asOf?: string; balance?: number; note?: string;
    };
    if (!body.accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
    if (typeof body.balance !== 'number' || !Number.isFinite(body.balance)) {
      return NextResponse.json({ error: 'balance must be a number' }, { status: 400 });
    }
    if (body.balance < 0) {
      return NextResponse.json(
        { error: 'balance must be a positive magnitude; direction comes from the account class' },
        { status: 400 });
    }
    await upsertBalanceSnapshot({
      accountId: body.accountId,
      asOf: body.asOf ?? new Date().toISOString().slice(0, 10),
      balance: body.balance, source: 'manual', note: body.note ?? '',
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error writing balance snapshot:', error);
    return NextResponse.json({ error: 'Failed to write balance snapshot' }, { status: 500 });
  }
}
