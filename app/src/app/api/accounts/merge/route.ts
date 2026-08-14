import { NextRequest, NextResponse } from 'next/server';
import { mergeAccounts } from '@/lib/accountMerge';

// POST /api/accounts/merge - merge one or more source accounts into a target account
export async function POST(request: NextRequest) {
  try {
    const { targetId, sourceIds } = (await request.json()) as { targetId: string; sourceIds: string[] };
    if (!targetId || !Array.isArray(sourceIds) || sourceIds.length === 0) {
      return NextResponse.json({ error: 'targetId and non-empty sourceIds required' }, { status: 400 });
    }
    const result = mergeAccounts(targetId, sourceIds);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}
