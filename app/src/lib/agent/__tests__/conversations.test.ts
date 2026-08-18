import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { createConversation, appendMessage, listConversations, deleteConversation, getMessages } from '@/lib/agent/conversations';

describe('conversation persistence', () => {
  it('round-trips messages in order', async () => {
    const { db } = makeTmpDb();
    const id = await createConversation('Test', db);
    await appendMessage(id, 'user', { text: 'hi' }, db);
    await appendMessage(id, 'assistant', { text: 'hello' }, db);
    const msgs = await getMessages(id, db);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1].content).toMatchObject({ text: 'hello' });
  });
});

describe('conversation history helpers', () => {
  it('lists non-empty conversations with a derived title, newest first, and deletes', async () => {
    const { db } = makeTmpDb();
    const empty = await createConversation('', db); // no user message → excluded
    const c1 = await createConversation('', db);
    await appendMessage(c1, 'user', { text: 'How much did I spend on groceries last month?' }, db);
    await appendMessage(c1, 'assistant', { text: 'About $420.' }, db);
    const c2 = await createConversation('', db);
    await appendMessage(c2, 'user', { text: 'Reconcile duplicates' }, db);

    const list = await listConversations(db);
    expect(list.map((c) => c.id)).toEqual([c2, c1]);
    expect(list.find((c) => c.id === c1)!.title).toBe('How much did I spend on groceries last month?');
    expect(list.some((c) => c.id === empty)).toBe(false);
    expect(list.find((c) => c.id === c1)!.messageCount).toBe(2);

    await deleteConversation(c1, db);
    expect((await listConversations(db)).some((c) => c.id === c1)).toBe(false);
    expect(await getMessages(c1, db)).toEqual([]);
  });
});
