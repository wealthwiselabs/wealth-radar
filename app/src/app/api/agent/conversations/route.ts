import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { listConversations, deleteConversation } from '@/lib/agent/conversations';

// GET /api/agent/conversations - List all conversations
export async function GET() {
  try {
    const conversations = await listConversations(getDb());
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
  }
}

// DELETE /api/agent/conversations - Delete a conversation by id
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const id = body?.id;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    await deleteConversation(id, getDb());
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });
  }
}
