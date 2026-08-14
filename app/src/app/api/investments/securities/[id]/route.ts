import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { applyTagCorrection } from '@/lib/investments/classifySecurities';

interface RouteContext { params: Promise<{ id: string }> }

// PATCH /api/investments/securities/[id] — manual tag correction (tag_source='user').
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const res = applyTagCorrection(getDb(), id, body);
    if (res.ok) return NextResponse.json({ ok: true });
    return NextResponse.json({ error: res.reason }, { status: res.reason === 'not_found' ? 404 : 400 });
  } catch (error) {
    console.error('Error correcting security tag:', error);
    return NextResponse.json({ error: 'Failed to update security' }, { status: 500 });
  }
}
