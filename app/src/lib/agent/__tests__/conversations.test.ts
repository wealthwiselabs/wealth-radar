import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { createConversation, appendMessage, getMessages } from '@/lib/agent/conversations';

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
