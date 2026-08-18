import { describe, it, expect } from 'vitest';
import { trimHistory, estimateMessageTokens, HISTORY_TOKEN_BUDGET } from '@/lib/agent/history';
import type { AgentMessage } from '@/lib/agent/providers/types';

const user = (text: string): AgentMessage => ({ role: 'user', text });
const asst = (text: string): AgentMessage => ({ role: 'assistant', text });
// ~big text: `chars` characters → ~chars/4 tokens.
const bigUser = (n: number, tag: string): AgentMessage => ({ role: 'user', text: tag + 'x'.repeat(n) });

describe('trimHistory', () => {
  it('returns the history unchanged when under budget', () => {
    const h = [user('hi'), asst('hello'), user('how much did I spend?')];
    expect(trimHistory(h, HISTORY_TOKEN_BUDGET)).toBe(h);
  });

  it('drops the oldest turns and keeps the most recent when over budget', () => {
    // Each message ~250k tokens (1,000,000 chars / 4). Budget here is 600k tokens.
    const budget = 600_000;
    const h = [
      bigUser(1_000_000, 'A_'), // ~250k tokens
      asst('x'.repeat(1_000_000)), // ~250k
      bigUser(1_000_000, 'B_'), // ~250k
      user('latest question'), // tiny — current turn
    ];
    const out = trimHistory(h, budget);
    // Fits budget now...
    const kept = out.reduce((s, m) => s + estimateMessageTokens(m), 0);
    expect(kept).toBeLessThanOrEqual(budget);
    // ...keeps the current (last) turn...
    expect(out[out.length - 1].text).toBe('latest question');
    // ...and dropped the oldest.
    expect(out.some((m) => m.text?.startsWith('A_'))).toBe(false);
    // First kept message is a user turn (well-formed for Anthropic).
    expect(out[0].role).toBe('user');
  });

  it('starts the trimmed history on a user turn (no orphaned tool_result)', () => {
    const budget = 100_000; // below the big OLD_ message (~250k tokens), so it must be dropped
    const h: AgentMessage[] = [
      bigUser(1_000_000, 'OLD_'),
      { role: 'assistant', toolCalls: [{ id: 't_0', name: 'edit', input: { a: 1 } }] },
      { role: 'tool', toolResult: { id: 't_0', content: 'ok' } },
      user('please continue'),
    ];
    const out = trimHistory(h, budget);
    expect(out[0].role).toBe('user');
    // The dangling assistant(tool_use)/tool pair from the trimmed region is gone.
    expect(out.some((m) => m.role === 'tool')).toBe(false);
  });

  it('never returns an empty history', () => {
    const out = trimHistory([bigUser(1_000_000, 'ONLY_')], 1);
    expect(out).toHaveLength(1);
    expect(out[0].text?.startsWith('ONLY_')).toBe(true);
  });

  it('uses a ~950k-token budget under the 1M window', () => {
    expect(HISTORY_TOKEN_BUDGET).toBeGreaterThan(900_000);
    expect(HISTORY_TOKEN_BUDGET).toBeLessThan(1_000_000);
  });
});
