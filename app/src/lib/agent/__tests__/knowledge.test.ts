import { describe, it, expect } from 'vitest';
import { loadKnowledgeTool } from '@/lib/agent/tools/knowledge';
import { KNOWLEDGE_MANIFEST } from '@/lib/agent/knowledge/manifest';

describe('knowledge', () => {
  it('manifest lists at least the allocation topic and load returns its body', async () => {
    expect(KNOWLEDGE_MANIFEST.some((k) => k.topic === 'portfolio-allocation')).toBe(true);
    const res = await loadKnowledgeTool.run({ topic: 'portfolio-allocation' }, {} as any);
    expect(res.isError).toBeFalsy();
    expect(res.content.length).toBeGreaterThan(0);
  });
  it('returns an error for an unknown topic', async () => {
    const res = await loadKnowledgeTool.run({ topic: 'nope' }, {} as any);
    expect(res.isError).toBe(true);
  });
});
