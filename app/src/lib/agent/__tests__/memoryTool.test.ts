import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { getAllMemory } from '@/lib/agent/memory';
import { saveMemoryTool } from '@/lib/agent/tools/memory';

describe('saveMemoryTool', () => {
  it('is gated none', () => {
    expect(saveMemoryTool.gate).toBe('none');
  });

  it('persists the fact and echoes key/value in the result', async () => {
    const { db } = makeTmpDb();
    const res = await saveMemoryTool.run({ key: 'goals', value: 'retire at 55' }, { db });
    expect(res.content).toMatch(/goals/);
    expect(res.content).toMatch(/retire at 55/);

    const all = await getAllMemory(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ key: 'goals', value: 'retire at 55' });
  });
});
