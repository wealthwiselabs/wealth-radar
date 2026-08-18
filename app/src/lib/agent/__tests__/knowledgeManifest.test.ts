import { describe, it, expect, vi, afterEach } from 'vitest';

// Regression for the prod outage: a missing knowledge .md file must NOT crash
// the manifest module. `manifest.ts` is imported by the chat route, so a throw
// at import time 500s the ENTIRE assistant. A missing/unreadable doc should
// drop just that one topic and leave the rest working — graceful degradation.
describe('knowledge manifest resilience', () => {
  afterEach(() => {
    vi.doUnmock('fs');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('does not throw at import when a doc file is missing, and drops only that topic', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const realFs = await vi.importActual<typeof import('fs')>('fs');
    // Simulate the exact prod failure: financial-priorities.md is absent.
    vi.doMock('fs', () => ({
      ...realFs,
      default: realFs,
      readFileSync: (p: unknown, enc?: unknown) => {
        if (String(p).endsWith('financial-priorities.md')) {
          const err = new Error(`ENOENT: no such file or directory, open '${p}'`) as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return (realFs.readFileSync as (a: unknown, b: unknown) => string)(p, enc);
      },
    }));

    const mod = await import('@/lib/agent/knowledge/manifest');

    // The missing doc is dropped, not fatal.
    expect(mod.KNOWLEDGE_MANIFEST.find((k) => k.topic === 'financial-priorities')).toBeUndefined();
    // Every other doc still loads with a non-empty body.
    expect(mod.KNOWLEDGE_MANIFEST.length).toBeGreaterThan(0);
    expect(mod.KNOWLEDGE_MANIFEST.every((k) => k.body.length > 0)).toBe(true);
    // The failure is surfaced in the logs, not swallowed silently.
    expect(warn).toHaveBeenCalled();
  });

  it('loads every topic when all files are present', async () => {
    vi.resetModules();
    const mod = await import('@/lib/agent/knowledge/manifest');
    expect(mod.KNOWLEDGE_MANIFEST.length).toBe(9);
    expect(mod.KNOWLEDGE_MANIFEST.find((k) => k.topic === 'financial-priorities')).toBeTruthy();
    expect(mod.KNOWLEDGE_MANIFEST.every((k) => k.body.length > 0)).toBe(true);
  });
});
