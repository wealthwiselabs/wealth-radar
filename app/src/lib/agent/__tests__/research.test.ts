import { describe, it, expect } from 'vitest';
import { makeDeepResearchTool, parseSubQuestions } from '@/lib/agent/tools/research';
import type { LLMProvider } from '@/lib/agent/providers/types';

// A fake provider that returns phase-appropriate output (distinguished by the
// system prompt) and records every pass's system + last user message.
function makeFakeProvider() {
  const systems: string[] = [];
  const userTexts: string[] = [];
  const provider: LLMProvider = {
    async *streamChat(req) {
      systems.push(req.system);
      userTexts.push(req.messages[req.messages.length - 1]?.text ?? '');
      if (req.system.includes('DECOMPOSE')) {
        yield {
          type: 'text',
          delta: 'What are current savings rates?\nHow do they compare to my reserve yield?',
        };
      } else if (req.system.includes('VERIFICATION + FUSION')) {
        yield {
          type: 'text',
          delta:
            'Verified report: top APYs ~4.5%. Sources: https://example.com/rates. ' +
            'Verification: confirmed against source; high confidence.',
        };
      } else {
        yield { type: 'text', delta: 'Finding: APYs ~4.5% [https://example.com/rates].' };
      }
      yield { type: 'done', stopReason: 'end' };
    },
  };
  return { provider, systems, userTexts };
}

describe('parseSubQuestions', () => {
  it('strips numbering/bullets and drops headings + short lines', () => {
    const out = parseSubQuestions(
      '1. What are current CD rates in the US?\n- How do they compare to savings?\n## Notes\nok',
      'fallback question here',
    );
    expect(out).toEqual([
      'What are current CD rates in the US?',
      'How do they compare to savings?',
    ]);
  });

  it('falls back to the original question when nothing usable is parsed', () => {
    expect(parseSubQuestions('\n\n', 'original question')).toEqual(['original question']);
  });

  it('caps the fan-out at 4 sub-questions', () => {
    const many = Array.from({ length: 8 }, (_, i) => `sub question number ${i} here`).join('\n');
    expect(parseSubQuestions(many, 'q').length).toBe(4);
  });
});

describe('deep_research tool', () => {
  it('is a read-only tool named deep_research', () => {
    const { provider } = makeFakeProvider();
    const tool = makeDeepResearchTool({ provider, model: 'x' });
    expect(tool.spec.name).toBe('deep_research');
    expect(tool.gate).toBe('none');
  });

  it('decomposes, researches each sub-question, then verifies+fuses into a cited report', async () => {
    const { provider, systems, userTexts } = makeFakeProvider();
    const tool = makeDeepResearchTool({ provider, model: 'x' });
    const res = await tool.run({ question: 'What are current savings rates?' }, { db: {} } as any);

    // 1 planner + 2 parallel research passes + 1 verify/fuse pass.
    expect(systems.filter((s) => s.includes('DECOMPOSE'))).toHaveLength(1);
    expect(systems.filter((s) => s.includes('investigating one facet'))).toHaveLength(2);
    expect(systems.filter((s) => s.includes('VERIFICATION + FUSION'))).toHaveLength(1);

    // The verify pass receives the per-sub-question draft.
    const verifyUser = userTexts[systems.findIndex((s) => s.includes('VERIFICATION + FUSION'))];
    expect(verifyUser).toContain('FINDINGS TO VERIFY AND SYNTHESIZE');
    expect(verifyUser).toContain('APYs ~4.5%');

    // Returned content is the verified, cited report.
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('Verified report');
    expect(res.content).toContain('Sources:');
    expect(res.content).toContain('Verification:');
  });
});
