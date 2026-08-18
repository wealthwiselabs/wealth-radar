import { describe, it, expect } from 'vitest';
import type { LLMProvider, LLMEvent } from '@/lib/agent/providers/types';
import { collect } from '@/lib/agent/providers/types';

describe('provider types', () => {
  it('collect() gathers an async event stream into an array', async () => {
    const fake: LLMProvider = {
      async *streamChat() {
        yield { type: 'text', delta: 'hi' } as LLMEvent;
        yield { type: 'done', stopReason: 'end' } as LLMEvent;
      },
    };
    const events = await collect(fake.streamChat({ system: '', messages: [], tools: [], model: 'm' }));
    expect(events).toEqual([
      { type: 'text', delta: 'hi' },
      { type: 'done', stopReason: 'end' },
    ]);
  });
});
