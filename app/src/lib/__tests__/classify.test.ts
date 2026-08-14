import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { createRule } from '@/lib/storage';

// Mock the Anthropic SDK so no network call happens.
const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: createMock }; },
}));

import { classifyTransactions } from '@/lib/classify';

const save = { ...process.env };
beforeEach(() => {
  createMock.mockReset();
  // createRule calls exportRules(), but exportRules() only writes when its
  // `db` is the real getDb() singleton (see storage.ts) — the temp db these
  // tests pass in is never that, so no fs mock is needed here.
});
afterEach(() => { process.env = { ...save }; });

describe('classifyTransactions', () => {
  it('uses an enabled rule and does NOT call Claude', async () => {
    const { db } = makeTmpDb();
    await createRule({ pattern: 'starbucks', categoryId: 'food', subcategoryId: 'coffee' }, db);
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const out = await classifyTransactions([{ description: 'STARBUCKS #123', amount: -4.5 }], { db });
    expect(out[0]).toEqual({ categoryId: 'food', subcategoryId: 'coffee' });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('ignores a disabled rule and falls through to Claude', async () => {
    const { db } = makeTmpDb();
    await createRule({ pattern: 'starbucks', categoryId: 'food', subcategoryId: 'coffee', enabled: false }, db);
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([{ index: 0, categoryId: 'other', subcategoryId: 'miscellaneous' }]) }],
    });
    const out = await classifyTransactions([{ description: 'STARBUCKS #123', amount: -4.5 }], { db });
    expect(out[0]).toEqual({ categoryId: 'other', subcategoryId: 'miscellaneous' });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('applies a rule on its first use, with no repeat-count threshold', async () => {
    const { db } = makeTmpDb();
    await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const out = await classifyTransactions([{ description: 'Kindle Svcs*BV80P7WZ2', amount: -9.99 }], { db });
    expect(out[0]).toEqual({ categoryId: 'education', subcategoryId: 'books' });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('leaves items uncategorized when no Anthropic key is set', async () => {
    const { db } = makeTmpDb();
    delete process.env.ANTHROPIC_API_KEY; delete process.env.CLAUDE_API_KEY;
    const out = await classifyTransactions([{ description: 'MYSTERY MERCHANT', amount: -9 }], { db });
    expect(out[0]).toEqual({ categoryId: '', subcategoryId: '' });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('classifies unresolved items via one Claude call', async () => {
    const { db } = makeTmpDb();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([{ index: 0, categoryId: 'shopping', subcategoryId: 'general' }]) }],
    });
    const out = await classifyTransactions([{ description: 'TARGET 00012', amount: -30, plaidCategory: 'Shops' }], { db });
    expect(out[0]).toEqual({ categoryId: 'shopping', subcategoryId: 'general' });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('resolves uncategorized (does not throw) when the Anthropic call fails', async () => {
    const { db } = makeTmpDb();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    createMock.mockRejectedValue(new Error('503'));
    const out = await classifyTransactions([{ description: 'MYSTERY', amount: -9 }], { db });
    expect(out[0]).toEqual({ categoryId: '', subcategoryId: '' });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('sends only unresolved items in one call and maps the result back by index', async () => {
    const { db } = makeTmpDb();
    await createRule({ pattern: 'starbucks', categoryId: 'food', subcategoryId: 'coffee' }, db);
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([{ index: 1, categoryId: 'shopping', subcategoryId: 'general' }]) }],
    });
    const out = await classifyTransactions([
      { description: 'STARBUCKS #1', amount: -4 },
      { description: 'TARGET 007', amount: -30, plaidCategory: 'Shops' },
    ], { db });
    expect(out[0]).toEqual({ categoryId: 'food', subcategoryId: 'coffee' });
    expect(out[1]).toEqual({ categoryId: 'shopping', subcategoryId: 'general' });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('leaves items uncategorized when Claude returns unparseable JSON', async () => {
    const { db } = makeTmpDb();
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'not json' }] });
    const out = await classifyTransactions([{ description: 'MYSTERY', amount: -9 }], { db });
    expect(out[0]).toEqual({ categoryId: '', subcategoryId: '' });
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
