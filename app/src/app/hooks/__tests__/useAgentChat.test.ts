import { describe, it, expect } from 'vitest';
import { parseSSEChunk } from '@/app/hooks/useAgentChat';

describe('parseSSEChunk', () => {
  it('extracts complete frames and keeps the remainder', () => {
    const { events, rest } = parseSSEChunk('data: {"type":"text","delta":"a"}\n\ndata: {"type":"done"}\n\ndata: {"type":"par');
    expect(events).toEqual([{ type: 'text', delta: 'a' }, { type: 'done' }]);
    expect(rest).toBe('data: {"type":"par');
  });
});
