import { NextRequest, NextResponse } from 'next/server';
import { createNetWorthAccount } from '@/lib/netWorth/write';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      catalogKey?: string; name?: string; value?: number | null;
      asOf?: string; securedByAccountId?: string | null;
    };
    if (!body.catalogKey || !body.name) {
      return NextResponse.json({ error: 'catalogKey and name are required' }, { status: 400 });
    }
    const id = await createNetWorthAccount({
      catalogKey: body.catalogKey, name: body.name, value: body.value ?? null,
      asOf: body.asOf, securedByAccountId: body.securedByAccountId ?? null,
    });
    return NextResponse.json({ id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create item';
    const status = /unknown catalog/i.test(message) ? 400 : 500;
    if (status === 500) console.error('Error creating net worth item:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
