import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { PURPOSES, type Purpose } from '@/lib/investments/purpose';

// PUT /api/investments/accounts/[id]/security-purpose
// body: { securityId: string, purpose: Purpose | null }
//
// Sets or clears one (account, security) purpose override. `null` deletes the
// row, which is how a holding goes back to inheriting the account's purpose.
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await request.json() as { securityId?: string; purpose?: string | null };
    const securityId = body.securityId?.trim();
    if (!securityId) {
      return NextResponse.json({ error: 'securityId is required' }, { status: 400 });
    }
    const purpose = body.purpose ?? null;
    if (purpose !== null && !(PURPOSES as readonly string[]).includes(purpose)) {
      return NextResponse.json(
        { error: `purpose must be null or one of: ${PURPOSES.join(', ')}` }, { status: 400 });
    }

    const db = getDb();
    const account = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
    if (!account || account.accountClass !== 'investment') {
      return NextResponse.json({ error: 'investment account not found' }, { status: 404 });
    }
    const security = db.select().from(schema.securities).where(eq(schema.securities.id, securityId)).get();
    if (!security) {
      return NextResponse.json({ error: 'security not found' }, { status: 404 });
    }

    const where = and(
      eq(schema.securityPurposes.accountId, id),
      eq(schema.securityPurposes.securityId, securityId),
    );
    const existing = db.select().from(schema.securityPurposes).where(where).get();
    const now = new Date().toISOString();

    if (purpose === null) {
      if (existing) db.delete(schema.securityPurposes).where(where).run();
      return NextResponse.json({ purpose: null });
    }
    if (existing) {
      db.update(schema.securityPurposes).set({ purpose, modifiedAt: now }).where(where).run();
    } else {
      db.insert(schema.securityPurposes).values({
        id: crypto.randomUUID(), accountId: id, securityId, purpose,
        createdAt: now, modifiedAt: now,
      }).run();
    }
    return NextResponse.json({ purpose: purpose as Purpose });
  } catch (error) {
    console.error('Error setting security purpose:', error);
    return NextResponse.json({ error: 'Failed to set security purpose' }, { status: 500 });
  }
}
