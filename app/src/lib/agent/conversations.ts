import { randomUUID } from 'crypto';
import { asc, eq } from 'drizzle-orm';
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
