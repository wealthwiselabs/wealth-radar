import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { runAgent } from '@/lib/agent/loop';
import type { LLMProvider, LLMEvent } from '@/lib/agent/providers/types';
import type { Tool } from '@/lib/agent/tools/types';

// Provider that yields two tool_call events for the same gated tool in the first
// turn (done with stopReason 'tool_use'), then ends on any subsequent turn.
function twoGatedCallsProvider(): LLMProvider {
  let turn = 0;
  return {
    async *streamChat(): AsyncIterable<LLMEvent> {
      if (turn++ === 0) {
        yield { type: 'tool_call', id: 't1', name: 'apply', input: { v: 'a' } };
        yield { type: 'tool_call', id: 't2', name: 'apply', input: { v: 'b' } };
        yield { type: 'done', stopReason: 'tool_use' };
      } else {
        yield { type: 'text', delta: 'ok' };
        yield { type: 'done', stopReason: 'end' };
      }
    },
  };
}

function makeApplyTool(record: string[]): Tool {
  return {
    gate: 'apply-undo',
    spec: { name: 'apply', description: 'apply', inputSchema: { type: 'object', properties: { v: { type: 'string' } } } },
    async run(input: { v: string }) { record.push(input.v); return { content: `applied:${input.v}` }; },
    async preview(input: { v: string }) {
      return { title: `Apply ${input.v}?`, diff: { summary: `will apply ${input.v}` }, confirmLabel: 'Confirm' };
    },
  };
}

async function drain(iter: AsyncIterable<any>) { const out: any[] = []; for await (const e of iter) out.push(e); return out; }

describe('runAgent batching of gated calls', () => {
  it('batches two same-turn gated calls into one proposal_batch and runs neither', async () => {
    const { db } = makeTmpDb();
    const ran: string[] = [];
    const tool = makeApplyTool(ran);
    const events = await drain(runAgent({
      provider: twoGatedCallsProvider(),
      model: 'm',
      system: '',
      messages: [{ role: 'user', text: 'go' }],
      tools: [tool],
      ctx: { db },
    }));

    const batches = events.filter((e) => e.type === 'proposal_batch');
    expect(batches).toHaveLength(1);
    const batch = batches[0];
    expect(batch.calls).toHaveLength(2);
    expect(batch.affordance.kind).toBe('confirm_batch');
    expect(batch.affordance.items).toHaveLength(2);
    expect(typeof batch.token).toBe('string');

    // No single-proposal event, and neither call executed.
    expect(events.find((e) => e.type === 'proposal')).toBeUndefined();
    expect(ran).toEqual([]);
  });

  it('runs granted gated calls directly without any proposal', async () => {
    const { db } = makeTmpDb();
    const ran: string[] = [];
    const tool = makeApplyTool(ran);
    const events = await drain(runAgent({
      provider: twoGatedCallsProvider(),
      model: 'm',
      system: '',
      messages: [{ role: 'user', text: 'go' }],
      tools: [tool],
      ctx: { db },
      grantedTools: new Set(['apply']),
    }));

    expect(events.find((e) => e.type === 'proposal_batch')).toBeUndefined();
    expect(events.find((e) => e.type === 'proposal')).toBeUndefined();
    // Both gated calls executed directly.
    expect(ran).toEqual(['a', 'b']);
  });
});
