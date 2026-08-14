import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: createMock }; },
}));

import { heuristicPattern, suggestPattern } from '@/lib/patternSuggest';

const save = { ...process.env };
beforeEach(() => { createMock.mockReset(); });
afterEach(() => { process.env = { ...save }; });

describe('heuristicPattern', () => {
  it('drops an order-id suffix after an asterisk', () => {
    expect(heuristicPattern('Kindle Svcs*BV80P7WZ2')).toBe('kindle svcs');
  });
  it('keeps the meaningful Costco distinction', () => {
    expect(heuristicPattern('COSTCO GAS #0423 SUNNYVALE CA')).toBe('costco gas');
    expect(heuristicPattern('COSTCO WHSE #0423 SUNNYVALE CA')).toBe('costco whse');
  });
  it('strips an Apple Pay prefix and keeps the real merchant', () => {
    expect(heuristicPattern('AplPay TEMU.COM 519079 SANTA MONICA CA PAYMENT@PINDUODUO.COM')).toBe('temu.com');
    expect(heuristicPattern('AplPay SAFEWAY #0700 0700 SANTA CLARA CA 800-898-4027')).toBe('safeway');
  });
  it('strips a trailing store number', () => {
    expect(heuristicPattern('TARGET 00012')).toBe('target');
  });
  it('leaves a clean description alone', () => {
    expect(heuristicPattern('Costco')).toBe('costco');
  });
});

describe('suggestPattern', () => {
  it('falls back to the heuristic with no API key', async () => {
    delete process.env.ANTHROPIC_API_KEY; delete process.env.CLAUDE_API_KEY;
    expect(await suggestPattern('Kindle Svcs*BV80P7WZ2')).toBe('kindle svcs');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('uses the model suggestion when it appears in the description', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'temu.com' }] });
    const got = await suggestPattern('AplPay TEMU.COM 519079 SANTA MONICA CA', { apiKey: 'sk-test' });
    expect(got).toBe('temu.com');
  });

  it('rejects a suggestion that is not a substring of the description', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'amazon prime' }] });
    const got = await suggestPattern('Kindle Svcs*BV80P7WZ2', { apiKey: 'sk-test' });
    expect(got).toBe('kindle svcs');
  });

  it('rejects a suggestion shorter than three characters', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'ki' }] });
    const got = await suggestPattern('Kindle Svcs*BV80P7WZ2', { apiKey: 'sk-test' });
    expect(got).toBe('kindle svcs');
  });

  it('falls back to the heuristic when the call fails', async () => {
    createMock.mockRejectedValue(new Error('503'));
    const got = await suggestPattern('Kindle Svcs*BV80P7WZ2', { apiKey: 'sk-test' });
    expect(got).toBe('kindle svcs');
  });
});
