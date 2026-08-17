import { describe, it, expect } from 'vitest';
import { sseEncode, streamLoopToSSE } from '@/app/api/agent/chat/sse';
import type { LoopEvent } from '@/lib/agent/loop';

async function* loop(): AsyncIterable<LoopEvent> {
  yield { type: 'text', delta: 'hello' };
  yield { type: 'done' };
}

describe('SSE encoding', () => {
  it('encodes a loop event as an SSE data frame', () => {
    expect(sseEncode({ type: 'text', delta: 'x' })).toBe('data: {"type":"text","delta":"x"}\n\n');
  });
  it('streamLoopToSSE yields frames for each event', async () => {
    const frames: string[] = [];
    for await (const f of streamLoopToSSE(loop())) frames.push(f);
    expect(frames.join('')).toContain('"delta":"hello"');
    expect(frames.join('')).toContain('"type":"done"');
  });
});
