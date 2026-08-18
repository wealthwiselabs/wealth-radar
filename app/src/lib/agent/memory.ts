import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { agentMemory } from '@/db/schema';

type Db = ReturnType<typeof getDb>;

export interface MemoryEntry {
  key: string;
  value: string;
  updatedAt: string;
}

export async function saveMemory(key: string, value: string, db: Db = getDb()): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(agentMemory)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: agentMemory.key, set: { value, updatedAt: now } });
}

export async function getAllMemory(db: Db = getDb()): Promise<MemoryEntry[]> {
  return db.select().from(agentMemory).orderBy(asc(agentMemory.key));
}

export async function deleteMemory(key: string, db: Db = getDb()): Promise<boolean> {
  const result = await db.delete(agentMemory).where(eq(agentMemory.key, key)).returning({ key: agentMemory.key });
  return result.length > 0;
}

export function formatMemoryForPrompt(entries: { key: string; value: string }[]): string {
  if (entries.length === 0) return '';
  return entries.map((e) => `- ${e.key}: ${e.value}`).join('\n');
}
