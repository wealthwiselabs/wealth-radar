import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { runAgent } from '@/lib/agent/loop';
import type { LLMProvider, LLMEvent } from '@/lib/agent/providers/types';
import type { Tool } from '@/lib/agent/tools/types';

// Provider that emits scripted events on each successive call.
function scriptedProvider(scripts: LLMEvent[][]): LLMProvider {
  let i = 0;
  return {
    async *streamChat() {
      const script = scripts[i++] ?? [{ type: 'done', stopReason: 'end' }];
      for (const e of script) yield e;
    },
  };
}

const echoTool: Tool = {
  gate: 'none',
  spec: { name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { v: { type: 'string' } } } },
  async run(input: { v: string }) { return { content: `echoed:${input.v}` }; },
};

const dangerTool: Tool = {
  gate: 'confirm',
  spec: { name: 'danger', description: 'danger', inputSchema: { type: 'object', properties: {} } },
  async run() { throw new Error('must not run without confirmation'); },
};

async function drain(iter: AsyncIterable<any>) { const out: any[] = []; for await (const e of iter) out.push(e); return out; }

describe('runAgent', () => {
  it('executes an ungated tool then continues to a final answer', async () => {
    const { db } = makeTmpDb();
    const provider = scriptedProvider([
      [{ type: 'tool_call', id: 't1', name: 'echo', input: { v: 'hi' } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', delta: 'done' }, { type: 'done', stopReason: 'end' }],
    ]);
    const events = await drain(runAgent({ provider, model: 'm', system: '', messages: [{ role: 'user', text: 'go' }], tools: [echoTool], ctx: { db } }));
    expect(events).toContainEqual({ type: 'tool_start', name: 'echo' });
    expect(events).toContainEqual({ type: 'text', delta: 'done' });
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('emits a proposal (never runs) for a gated tool', async () => {
    const { db } = makeTmpDb();
    const provider = scriptedProvider([
      [{ type: 'tool_call', id: 't1', name: 'danger', input: {} }, { type: 'done', stopReason: 'tool_use' }],
    ]);
    const events = await drain(runAgent({ provider, model: 'm', system: '', messages: [], tools: [dangerTool], ctx: { db } }));
    const proposal = events.find((e) => e.type === 'proposal');
    expect(proposal).toBeTruthy();
    expect(proposal.toolName).toBe('danger');
    expect(typeof proposal.token).toBe('string');
  });
});
