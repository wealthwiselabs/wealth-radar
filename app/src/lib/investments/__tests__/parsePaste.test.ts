import { describe, it, expect } from 'vitest';
import { parseHoldingsPaste, extractJson, coerceParseResult } from '@/lib/investments/parsePaste';

function fakeClient(reply: string) {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'text' as const, text: reply }] }),
    },
  };
}

describe('extractJson', () => {
  it('passes bare json through', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
  it('strips a fenced block', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
});

describe('coerceParseResult', () => {
  it('keeps well-formed rows and normalizes an empty ticker to null', () => {
    const r = coerceParseResult({
      holdings: [
        { ticker: 'VTI', name: 'Vanguard Total Stock', quantity: 2, value: 600 },
        { ticker: '', name: 'Stable Value Fund', quantity: null, value: 400 },
      ],
      detectedTotal: 1000,
    });
    expect(r.holdings).toHaveLength(2);
    expect(r.holdings[1].ticker).toBeNull();
    expect(r.detectedTotal).toBe(1000);
  });

  it('drops rows without a usable value', () => {
    const r = coerceParseResult({ holdings: [{ ticker: 'VTI', name: 'x', quantity: 1, value: 'abc' }] });
    expect(r.holdings).toHaveLength(0);
  });

  it('drops rows with no name and no ticker', () => {
    const r = coerceParseResult({ holdings: [{ ticker: null, name: '', quantity: 1, value: 100 }] });
    expect(r.holdings).toHaveLength(0);
  });

  it('returns an empty result for junk', () => {
    expect(coerceParseResult(null).holdings).toEqual([]);
    expect(coerceParseResult({ holdings: 'nope' }).holdings).toEqual([]);
  });

  it('drops rows with empty string value', () => {
    const r = coerceParseResult({ holdings: [{ ticker: 'VTI', name: 'x', quantity: 1, value: '' }] });
    expect(r.holdings).toHaveLength(0);
  });

  it('drops rows with whitespace-only value', () => {
    const r = coerceParseResult({ holdings: [{ ticker: 'VTI', name: 'x', quantity: 1, value: '   ' }] });
    expect(r.holdings).toHaveLength(0);
  });

  it('keeps rows with $0 value and numeric 0 value', () => {
    const r = coerceParseResult({
      holdings: [
        { ticker: 'VTI', name: 'Fund A', quantity: 1, value: '$0' },
        { ticker: 'VGT', name: 'Fund B', quantity: 2, value: 0 },
      ],
    });
    expect(r.holdings).toHaveLength(2);
    expect(r.holdings[0].value).toBe(0);
    expect(r.holdings[1].value).toBe(0);
  });
});

describe('parseHoldingsPaste', () => {
  it('parses a model reply into holdings', async () => {
    const client = fakeClient(JSON.stringify({
      holdings: [{ ticker: 'VGT', name: 'Vanguard Information Technology ETF', quantity: 120.5, value: 68853.17 }],
      detectedTotal: 68853.17,
    }));
    const r = await parseHoldingsPaste('VGT 120.5 $68,853.17', { apiKey: 'k', client });
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0].ticker).toBe('VGT');
    expect(r.holdings[0].value).toBeCloseTo(68853.17, 2);
  });

  it('returns an empty result with the error preserved when the model returns junk', async () => {
    const r = await parseHoldingsPaste('anything', { apiKey: 'k', client: fakeClient('not json at all') });
    expect(r.holdings).toEqual([]);
    expect(r.error).toBeTruthy();
  });

  it('returns an error rather than throwing when no api key is configured', async () => {
    // The env vars must be cleared explicitly: a developer with a real key in
    // their shell would otherwise see this pass for the wrong reason locally
    // and fail in CI, or vice versa.
    const saved = { a: process.env.ANTHROPIC_API_KEY, c: process.env.CLAUDE_API_KEY };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    try {
      const r = await parseHoldingsPaste('text', { apiKey: '' });
      expect(r.holdings).toEqual([]);
      expect(r.error).toMatch(/api key/i);
    } finally {
      if (saved.a) process.env.ANTHROPIC_API_KEY = saved.a;
      if (saved.c) process.env.CLAUDE_API_KEY = saved.c;
    }
  });

  it('returns an empty result for empty input without calling the model', async () => {
    let called = false;
    const client = {
      messages: { create: async () => { called = true; return { content: [] }; } },
    };
    const r = await parseHoldingsPaste('   ', { apiKey: 'k', client });
    expect(called).toBe(false);
    expect(r.holdings).toEqual([]);
  });

  it('returns an empty result with error when client.messages.create throws synchronously', async () => {
    const client = {
      messages: {
        create: async () => {
          throw new Error('Simulated synchronous throw');
        },
      },
    };
    const r = await parseHoldingsPaste('some text', { apiKey: 'k', client });
    expect(r.holdings).toEqual([]);
    expect(r.error).toMatch(/synchronous throw/);
  });
});
