import { describe, it, expect } from 'vitest';
import { makeDeepResearchTool } from '@/lib/agent/tools/research';
import type { LLMProvider } from '@/lib/agent/providers/types';

// A fake provider that just streams a synthesized answer and stops — enough to
// prove the tool collects the sub-agent's text output.
const fakeProvider: LLMProvider = {
  async *streamChat() {
    yield { type: 'text', delta: 'Top savings APYs are around 4.5%. ' };
    yield { type: 'text', delta: 'Sources: https://example.com/rates' };
    yield { type: 'done', stopReason: 'end' };
  },
};

describe('deep_research tool', () => {
  it('is a read-only tool named deep_research', () => {
    const tool = makeDeepResearchTool({ provider: fakeProvider, model: 'x' });
    expect(tool.spec.name).toBe('deep_research');
    expect(tool.gate).toBe('none');
    expect(tool.spec.inputSchema.required).toContain('question');
  });

  it('returns the sub-agent\'s synthesized answer', async () => {
    const tool = makeDeepResearchTool({ provider: fakeProvider, model: 'x' });
    const res = await tool.run({ question: 'What are current savings rates?' }, { db: {} } as any);
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('4.5%');
    expect(res.content).toContain('Sources');
  });
});
