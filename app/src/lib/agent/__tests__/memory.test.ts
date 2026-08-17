import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { saveMemory, getAllMemory, deleteMemory, formatMemoryForPrompt } from '@/lib/agent/memory';

describe('agent memory store', () => {
  it('saveMemory inserts a new key', async () => {
    const { db } = makeTmpDb();
    await saveMemory('risk_tolerance', 'moderate', db);
    const all = await getAllMemory(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ key: 'risk_tolerance', value: 'moderate' });
  });

  it('saveMemory on an existing key updates rather than duplicates', async () => {
    const { db } = makeTmpDb();
    await saveMemory('risk_tolerance', 'moderate', db);
    await saveMemory('risk_tolerance', 'aggressive', db);
    const all = await getAllMemory(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ key: 'risk_tolerance', value: 'aggressive' });
  });

  it('getAllMemory returns entries ordered by key ascending', async () => {
    const { db } = makeTmpDb();
    await saveMemory('zebra', '1', db);
    await saveMemory('alpha', '2', db);
    await saveMemory('mango', '3', db);
    const all = await getAllMemory(db);
    expect(all.map((e) => e.key)).toEqual(['alpha', 'mango', 'zebra']);
  });

  it('deleteMemory removes an existing key and returns true', async () => {
    const { db } = makeTmpDb();
    await saveMemory('goal', 'retire early', db);
    const removed = await deleteMemory('goal', db);
    expect(removed).toBe(true);
    const all = await getAllMemory(db);
    expect(all).toHaveLength(0);
  });

  it('deleteMemory returns false for a missing key', async () => {
    const { db } = makeTmpDb();
    const removed = await deleteMemory('nonexistent', db);
    expect(removed).toBe(false);
  });

  it('formatMemoryForPrompt returns empty string for no entries', () => {
    expect(formatMemoryForPrompt([])).toBe('');
  });

  it('formatMemoryForPrompt returns one line per entry', () => {
    const text = formatMemoryForPrompt([
      { key: 'risk_tolerance', value: 'moderate' },
      { key: 'goal', value: 'retire early' },
    ]);
    expect(text).toBe('- risk_tolerance: moderate\n- goal: retire early');
  });
});
