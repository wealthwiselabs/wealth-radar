import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { makeSpawnTaskTool } from '@/lib/agent/tools/spawn';
import type { LLMProvider, LLMEvent } from '@/lib/agent/providers/types';

function scripted(events: LLMEvent[]): LLMProvider { return { async *streamChat() { for (const e of events) yield e; } }; }

describe('spawn_task', () => {
  it('runs a bounded sub-loop and returns its text as a summary', async () => {
    const { db } = makeTmpDb();
    const tool = makeSpawnTaskTool({ provider: scripted([{ type: 'text', delta: 'summary text' }, { type: 'done', stopReason: 'end' }]), model: 'm' });
    const res = await tool.run({ goal: 'analyze' }, { db });
    expect(res.content).toContain('summary text');
  });
});
