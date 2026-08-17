import { describe, it, expect } from 'vitest';
import { createOpenAIProvider, type OpenAILike } from '@/lib/agent/providers/openai';
import { collect } from '@/lib/agent/providers/types';

function fake(chunks: any[]): OpenAILike {
  return { chat: { completions: { create: async () => ({ async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; } }) } } };
}

describe('OpenAIProvider', () => {
  it('normalizes text deltas and finish', async () => {
    const provider = createOpenAIProvider({ apiKey: 'k', client: fake([
      { choices: [{ delta: { content: 'Hi' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]) });
    const events = await collect(provider.streamChat({ system: 's', messages: [{ role: 'user', text: 'x' }], tools: [], model: 'gpt-5.6' }));
    expect(events).toContainEqual({ type: 'text', delta: 'Hi' });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end' });
  });

  it('normalizes accumulated tool_calls into a tool_call event', async () => {
    const provider = createOpenAIProvider({ apiKey: 'k', client: fake([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search_transactions', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":"amazon"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]) });
    const events = await collect(provider.streamChat({ system: 's', messages: [], tools: [], model: 'gpt-5.6' }));
    expect(events).toContainEqual({ type: 'tool_call', id: 'call_1', name: 'search_transactions', input: { q: 'amazon' } });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });
});
