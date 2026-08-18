import { randomUUID } from 'crypto';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { agentConversations, agentMessages } from '@/db/schema';

type Db = ReturnType<typeof getDb>;

export interface StoredMessage {
  id: string;
  role: string;
  content: any;
  createdAt: string;
}

export async function createConversation(title: string, db: Db = getDb()): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.insert(agentConversations).values({ id, title, createdAt: now, modifiedAt: now });
  return id;
}

export async function appendMessage(
  conversationId: string,
  role: string,
  content: unknown,
  db: Db = getDb(),
): Promise<void> {
  await db.insert(agentMessages).values({
    id: randomUUID(),
    conversationId,
    role,
    content: JSON.stringify(content),
    createdAt: new Date().toISOString(),
  });
}

export async function getMessages(conversationId: string, db: Db = getDb()): Promise<StoredMessage[]> {
  const rows = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, conversationId))
    .orderBy(asc(agentMessages.createdAt));
  return rows.map((r) => ({ id: r.id, role: r.role, content: JSON.parse(r.content), createdAt: r.createdAt }));
}

export type ConversationSummary = { id: string; title: string; modifiedAt: string; messageCount: number };

function messageText(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return typeof parsed?.text === 'string' ? parsed.text : '';
  } catch {
    return '';
  }
}

export async function listConversations(db: Db = getDb()): Promise<ConversationSummary[]> {
  const conversations = await db
    .select()
    .from(agentConversations)
    // modifiedAt is only set at creation time today (appendMessage does not bump it), so two
    // conversations created within the same millisecond would tie on modifiedAt; break ties by
    // insertion order (rowid) so newest-created still sorts first.
    .orderBy(desc(agentConversations.modifiedAt), desc(sql`rowid`));

  const summaries: ConversationSummary[] = [];
  for (const conv of conversations) {
    const messages = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.conversationId, conv.id))
      .orderBy(asc(agentMessages.createdAt), asc(sql`rowid`));

    const firstUserMessage = messages.find((m) => m.role === 'user');
    if (!firstUserMessage) continue;

    const rawTitle = messageText(firstUserMessage.content).trim();
    const title = rawTitle.length > 0 ? rawTitle.slice(0, 60) : 'New chat';

    const messageCount = messages.filter(
      (m) => (m.role === 'user' || m.role === 'assistant') && messageText(m.content).trim().length > 0,
    ).length;

    summaries.push({ id: conv.id, title, modifiedAt: conv.modifiedAt, messageCount });
  }

  return summaries;
}

export async function deleteConversation(id: string, db: Db = getDb()): Promise<void> {
  await db.delete(agentMessages).where(eq(agentMessages.conversationId, id));
  await db.delete(agentConversations).where(eq(agentConversations.id, id));
}
