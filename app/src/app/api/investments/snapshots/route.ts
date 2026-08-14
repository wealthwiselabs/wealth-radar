import { NextRequest, NextResponse } from 'next/server';
import {
  commitSnapshot, listSnapshots, ReconciliationError, type ParsedHolding,
} from '@/lib/investments/snapshots';

export async function GET(request: NextRequest) {
  try {
    const accountId = request.nextUrl.searchParams.get('accountId');
    return NextResponse.json({ snapshots: await listSnapshots(accountId) });
  } catch (error) {
    console.error('Error listing snapshots:', error);
    return NextResponse.json({ error: 'Failed to list snapshots' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      accountId?: string; asOf?: string; source?: string; totalValue?: number;
      holdings?: ParsedHolding[]; note?: string; acknowledgeMismatch?: boolean;
    };
    if (!body.accountId || !body.asOf || typeof body.totalValue !== 'number') {
      return NextResponse.json(
        { error: 'accountId, asOf, and totalValue are required' }, { status: 400 });
    }

    const result = await commitSnapshot({
      accountId: body.accountId,
      asOf: body.asOf,
      source: body.source ?? 'manual',
      totalValue: body.totalValue,
      holdings: body.holdings ?? [],
      note: body.note,
      acknowledgeMismatch: body.acknowledgeMismatch,
    });
    return NextResponse.json(result);
  } catch (error) {
    // A reconciliation refusal is a user-fixable 409, not a server fault. It is
    // identified by type, not by message text: commitSnapshot also throws
    // constraint and I/O errors, and those must stay 500s with their raw text
    // in the log rather than in the user's face.
    if (error instanceof ReconciliationError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Error committing snapshot:', error);
    return NextResponse.json({ error: 'Failed to commit snapshot' }, { status: 500 });
  }
}
