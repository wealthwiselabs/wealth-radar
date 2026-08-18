import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { runAgent } from '@/lib/agent/loop';
import type { Tool } from '@/lib/agent/tools/types';
import type { LLMProvider, LLMEvent } from '@/lib/agent/providers/types';

let ran = false;
const gated: Tool = {
  gate: 'confirm',
  spec: {
    name: 'do_it',
    description: 'x',
    inputSchema: { type: 'object', properties: {} },
  },
  async run() {
    ran = true;
    return { content: 'done' };
  },
  // Proposal preview builder:
  preview: async () => ({ title: 'Do it?', diff: { summary: 'will do it' }, confirmLabel: 'Do it' }),
};

function scripted(events: LLMEvent[]): LLMProvider {
  return {
    async *streamChat() {
      for (const e of events) yield e;
    },
  };
}
async function drain(it: AsyncIterable<any>) {
  const o: any[] = [];
  for await (const e of it) o.push(e);
  return o;
}

describe('confirm flow', () => {
  it('emits a confirm affordance carrying the preview and does not run the tool', async () => {
    ran = false;
    const { db } = makeTmpDb();
    const events = await drain(
      runAgent({
        provider: scripted([
          { type: 'tool_call', id: 't', name: 'do_it', input: {} },
          { type: 'done', stopReason: 'tool_use' },
        ]),
        model: 'm',
        system: '',
        messages: [],
        tools: [gated],
        ctx: { db },
      }),
    );
    const proposal = events.find((e) => e.type === 'proposal');
    expect(proposal.affordance.kind).toBe('confirm');
    expect(proposal.affordance.title).toBe('Do it?');
    expect(ran).toBe(false);
  });
});
