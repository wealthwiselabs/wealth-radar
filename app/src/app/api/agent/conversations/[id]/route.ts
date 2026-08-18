import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { getMessages, type StoredMessage } from '@/lib/agent/conversations';

interface RouteContext {
  params: Promise<{ id: string }>;
}

type ChatMessage = { role: 'user' | 'assistant'; text: string };

// Only user/assistant turns with actual prose belong in the transcript view —
// tool rows and text-less tool-call-only assistant rows (proposals awaiting
// approval) are dropped.
function toChatMessage(m: StoredMessage): ChatMessage | null {
  if (m.role !== 'user' && m.role !== 'assistant') return null;
  const text = m.content?.text;
  if (typeof text !== 'string' || text.length === 0) return null;
  return { role: m.role, text };
}

// GET /api/agent/conversations/[id] - Get a conversation's messages
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const stored = await getMessages(id, getDb());
    const messages = stored
      .map(toChatMessage)
      .filter((m): m is ChatMessage => m !== null);
    return NextResponse.json({ messages });
  } catch (error) {
    console.error('Error fetching conversation messages:', error);
    return NextResponse.json({ error: 'Failed to fetch conversation messages' }, { status: 500 });
  }
}
