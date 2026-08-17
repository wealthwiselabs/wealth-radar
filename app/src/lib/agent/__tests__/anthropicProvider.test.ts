import { describe, it, expect } from 'vitest';
import { createAnthropicProvider, type AnthropicLike } from '@/lib/agent/providers/anthropic';
import { collect } from '@/lib/agent/providers/types';

// Fake that mimics the raw-event stream shape the adapter consumes.
function fakeClient(rawEvents: any[]): AnthropicLike {
  return {
    messages: {
      stream(_params: unknown) {
        return {
          async *[Symbol.asyncIterator]() {
            for (const e of rawEvents) yield e;
          },
        };
      },
    },
  };
}

describe('AnthropicProvider', () => {
  it('normalizes text deltas and end_turn', async () => {
    const client = fakeClient([
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ]);
    const provider = createAnthropicProvider({ apiKey: 'k', client });
    const events = await collect(
      provider.streamChat({ system: 's', messages: [{ role: 'user', text: 'hi' }], tools: [], model: 'claude-sonnet-5' }),
    );
    expect(events).toContainEqual({ type: 'text', delta: 'Hel' });
    expect(events).toContainEqual({ type: 'text', delta: 'lo' });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end' });
  });

  it('normalizes a tool_use block into a tool_call event', async () => {
    const client = fakeClient([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'search_transactions' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"q":"amazon"}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    ]);
    const provider = createAnthropicProvider({ apiKey: 'k', client });
    const events = await collect(
      provider.streamChat({ system: 's', messages: [], tools: [], model: 'claude-sonnet-5' }),
    );
    expect(events).toContainEqual({ type: 'tool_call', id: 'tu_1', name: 'search_transactions', input: { q: 'amazon' } });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });
});
