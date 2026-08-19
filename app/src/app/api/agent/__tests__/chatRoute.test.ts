import { describe, it, expect, vi } from 'vitest';
import { sseEncode, streamLoopToSSE } from '@/app/api/agent/chat/sse';
import type { LoopEvent } from '@/lib/agent/loop';
import { makeTmpDb } from '@/test/tmpDb';
import type { LLMProvider, LLMRequest } from '@/lib/agent/providers/types';

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

// --- POST /api/agent/chat: viewContext.sections reach the system prompt ---
//
// Mirrors the mocking style of memoryRoute.test.ts (mock @/db/client to a
// tmp db) plus a mocked provider so we can capture the exact `system` string
// runAgent hands to the LLM, without touching a real API key or network.
const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

let capturedSystem = '';
vi.mock('@/lib/agent/providers', () => ({
  createProvider: (): LLMProvider => ({
    async *streamChat(req: LLMRequest) {
      capturedSystem = req.system;
      yield { type: 'done', stopReason: 'end' };
    },
  }),
}));

describe('chat route: view context sections', () => {
  it('renders a sections snapshot into the <current_view> system-prompt note', async () => {
    capturedSystem = '';
    const { POST } = await import('@/app/api/agent/chat/route');
    const req = new Request('http://t/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-api-key': 'test-key' },
      body: JSON.stringify({
        message: 'what am I looking at?',
        viewContext: {
          route: '/investments', label: 'Investments', highlights: [],
          sections: [{
            id: 'investments.holdings', title: 'Holdings breakdown', summary: '2 accounts',
            detail: { tool: 'get_holdings_breakdown', args: { account: 'all' } },
          }],
        },
      }),
    }) as never;

    const res = await POST(req);
    // Drain the SSE stream so the loop (and its call into the mocked
    // provider, which captures `system`) actually runs to completion.
    const reader = res.body!.getReader();
    while (!(await reader.read()).done) { /* drain */ }

    expect(capturedSystem).toContain('Sections on screen');
    expect(capturedSystem).toContain('Holdings breakdown: 2 accounts [details: get_holdings_breakdown');
  });
});
