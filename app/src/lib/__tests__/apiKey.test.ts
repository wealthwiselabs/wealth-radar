import { describe, it, expect, afterEach, vi } from 'vitest';
import { getAgentKeyHeaders } from '@/lib/apiKey';

describe('getAgentKeyHeaders', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the stored anthropic key with provider/model defaults', () => {
    const store = new Map<string, string>([['expense-tracker:anthropic-api-key', 'sk-test']]);
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
    const h = getAgentKeyHeaders();
    expect(h['x-agent-api-key']).toBe('sk-test');
    expect(h['x-agent-provider']).toBe('anthropic');
    expect(h['x-agent-model']).toBe('claude-sonnet-5');
  });

  it('omits x-agent-api-key when no key is stored', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
    const h = getAgentKeyHeaders();
    expect(h['x-agent-api-key']).toBeUndefined();
    expect(h['x-agent-provider']).toBe('anthropic');
    expect(h['x-agent-model']).toBe('claude-sonnet-5');
  });

  it('uses gpt-5.6 default model and includes base URL for non-anthropic providers', () => {
    const store = new Map<string, string>([
      ['wealthwise:agent-provider', 'openai'],
      ['wealthwise:agent-base-url', 'https://example.com/v1'],
    ]);
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
    const h = getAgentKeyHeaders();
    expect(h['x-agent-provider']).toBe('openai');
    expect(h['x-agent-model']).toBe('gpt-5.6');
    expect(h['x-agent-base-url']).toBe('https://example.com/v1');
  });

  it('returns {} when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    expect(getAgentKeyHeaders()).toEqual({});
  });
});
