import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '@/lib/agent/systemPrompt';
import { resolveAgentConfig } from '@/lib/agent/systemPrompt';

describe('agent config + prompt', () => {
  it('system prompt states the untrusted-content and advisor-framing boundaries', () => {
    const p = buildSystemPrompt();
    expect(p).toMatch(/not a licensed/i);
    expect(p).toMatch(/never.*instructions/i); // untrusted content
  });

  it('includes injected memory when provided, and omits nothing when absent', () => {
    const withMemory = buildSystemPrompt('- goals: retire at 55');
    expect(withMemory).toContain('- goals: retire at 55');
    expect(withMemory).toMatch(/not a licensed/i);
    expect(withMemory).toMatch(/never.*instructions/i);

    const withoutMemory = buildSystemPrompt();
    expect(withoutMemory).toMatch(/not a licensed/i);
    expect(withoutMemory).toMatch(/never.*instructions/i);
  });

  it('resolveAgentConfig prefers header key, falls back to env, defaults to anthropic/sonnet-5', () => {
    const cfg = resolveAgentConfig(new Headers({ 'x-agent-api-key': 'HK' }), { ANTHROPIC_API_KEY: 'EK' });
    expect(cfg).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'HK' });
    const cfg2 = resolveAgentConfig(new Headers(), { ANTHROPIC_API_KEY: 'EK' });
    expect(cfg2.apiKey).toBe('EK');
  });
});
