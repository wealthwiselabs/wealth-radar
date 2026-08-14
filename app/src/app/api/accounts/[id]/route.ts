import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { applyAccountPatch, PURPOSES, type AccountPatchBody } from '@/lib/accountLifecycle';
import { ACCOUNT_OWNER_OPTIONS } from '@/lib/owners';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// PATCH /api/accounts/[id] - rename / set owner / status / closedAtMonth
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as AccountPatchBody;
    if (body.status !== undefined && body.status !== 'active' && body.status !== 'closed') {
      return NextResponse.json({ error: 'status must be active or closed' }, { status: 400 });
    }
    if (body.owner !== undefined && !ACCOUNT_OWNER_OPTIONS.includes(body.owner)) {
      return NextResponse.json({ error: `owner must be one of: ${ACCOUNT_OWNER_OPTIONS.join(', ')}` }, { status: 400 });
    }
    if (body.purpose !== undefined && !PURPOSES.includes(body.purpose)) {
      return NextResponse.json({ error: `purpose must be one of: ${PURPOSES.join(', ')}` }, { status: 400 });
    }

    const db = getDb();

    const existing = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    db.update(schema.accounts)
      .set(applyAccountPatch(existing, body))
      .where(eq(schema.accounts.id, id))
      .run();

    const account = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
    return NextResponse.json({ account });
  } catch (error) {
    console.error('Error updating account:', error);
    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 });
  }
}
