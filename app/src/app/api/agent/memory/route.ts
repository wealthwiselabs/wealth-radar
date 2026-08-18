import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { getAllMemory, deleteMemory } from '@/lib/agent/memory';

// GET /api/agent/memory - List everything the agent has remembered
export async function GET() {
  try {
    const memory = await getAllMemory(getDb());
    return NextResponse.json({ memory });
  } catch (error) {
    console.error('Error fetching agent memory:', error);
    return NextResponse.json({ error: 'Failed to fetch memory' }, { status: 500 });
  }
}

// DELETE /api/agent/memory - Forget a single remembered fact by key
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const key = body?.key;
    if (!key || typeof key !== 'string') {
      return NextResponse.json({ error: 'key is required' }, { status: 400 });
    }
    const removed = await deleteMemory(key, getDb());
    return NextResponse.json({ ok: true, removed });
  } catch (error) {
    console.error('Error deleting agent memory:', error);
    return NextResponse.json({ error: 'Failed to delete memory' }, { status: 500 });
  }
}
