import { NextResponse } from 'next/server';
import { isPlaidConfigured } from '@/lib/plaid/config';
import { syncAllInvestments } from '@/lib/plaid/syncAllInvestments';
import { getDb } from '@/db/client';
import { getPlaidClient } from '@/lib/plaid/client';

export async function POST(request: Request) {
  if (!isPlaidConfigured()) return NextResponse.json({ error: 'Plaid not configured' }, { status: 404 });
  try {
    const apiKey = request.headers.get('x-anthropic-api-key') ?? undefined;
    return NextResponse.json(await syncAllInvestments(getDb(), { client: getPlaidClient(), apiKey }));
  } catch (error) {
    console.error('Error syncing investments:', error);
    return NextResponse.json({ error: 'Failed to sync investments' }, { status: 500 });
  }
}
