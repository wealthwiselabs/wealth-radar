import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { accounts } from '@/db/schema';
import { closeNetWorthAccount, deleteNetWorthAccount, AccountHasHistoryError } from '@/lib/netWorth/write';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await request.json() as {
      name?: string; reviewIntervalMonths?: number | null;
      securedByAccountId?: string | null; closedAtMonth?: string;
      valuationProvider?: string | null; valuationRef?: string | null;
    };
    if (body.closedAtMonth) {
      await closeNetWorthAccount(id, body.closedAtMonth);
      return NextResponse.json({ ok: true });
    }
    const patch: Record<string, unknown> = { modifiedAt: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.reviewIntervalMonths !== undefined) patch.reviewIntervalMonths = body.reviewIntervalMonths;
    if (body.securedByAccountId !== undefined) patch.securedByAccountId = body.securedByAccountId;
    // null clears either field, so a user can turn estimates back off.
    if (body.valuationProvider !== undefined) patch.valuationProvider = body.valuationProvider;
    if (body.valuationRef !== undefined) patch.valuationRef = body.valuationRef;
    getDb().update(accounts).set(patch).where(eq(accounts.id, id)).run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error updating net worth item:', error);
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteNetWorthAccount(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AccountHasHistoryError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Error deleting net worth item:', error);
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}
