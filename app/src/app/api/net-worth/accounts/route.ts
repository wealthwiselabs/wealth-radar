import { NextRequest, NextResponse } from 'next/server';
import { createNetWorthAccount, DuplicateItemNameError } from '@/lib/netWorth/write';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      catalogKey?: string; name?: string; value?: number | null;
      asOf?: string; securedByAccountId?: string | null;
    };
    if (!body.catalogKey || !body.name) {
      return NextResponse.json({ error: 'catalogKey and name are required' }, { status: 400 });
    }
    // Same invariant the snapshot route enforces: balances are positive
    // magnitudes, sign is derived from account class. Order matters — NaN < 0
    // is false, so the finiteness check must run first or a NaN would slip
    // past the negative check below.
    if (body.value !== null && body.value !== undefined) {
      if (typeof body.value !== 'number' || !Number.isFinite(body.value)) {
        return NextResponse.json({ error: 'value must be a number' }, { status: 400 });
      }
      if (body.value < 0) {
        return NextResponse.json(
          { error: 'value must be a positive magnitude; direction comes from the account class' },
          { status: 400 });
      }
    }
    const id = await createNetWorthAccount({
      catalogKey: body.catalogKey, name: body.name, value: body.value ?? null,
      asOf: body.asOf, securedByAccountId: body.securedByAccountId ?? null,
    });
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof DuplicateItemNameError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : 'Failed to create item';
    const status = /unknown catalog/i.test(message) ? 400 : 500;
    if (status === 500) console.error('Error creating net worth item:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
