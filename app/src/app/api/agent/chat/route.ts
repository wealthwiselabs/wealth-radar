import { NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { runAgent, type LoopEvent } from '@/lib/agent/loop';
import { createAnthropicProvider } from '@/lib/agent/providers/anthropic';
import { readTools } from '@/lib/agent/tools/read';
import { buildSystemPrompt, resolveAgentConfig } from '@/lib/agent/systemPrompt';
import { createConversation, appendMessage, getMessages } from '@/lib/agent/conversations';
import type { AgentMessage } from '@/lib/agent/providers/types';

export function sseEncode(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function* streamLoopToSSE(loop: AsyncIterable<LoopEvent>): AsyncIterable<string> {
  for await (const e of loop) yield sseEncode(e);
}

function toAgentMessages(stored: { role: string; content: any }[]): AgentMessage[] {
  return stored.map((m) => ({
    role: m.role as AgentMessage['role'],
    text: m.content?.text,
    toolCalls: m.content?.toolCalls,
    toolResult: m.content?.toolResult,
  }));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const cfg = resolveAgentConfig(req.headers, process.env as Record<string, string | undefined>);
  if (!cfg.apiKey) return new Response('No API key configured', { status: 401 });
  const db = getDb();

  const conversationId: string = body.conversationId || (await createConversation('', db));
  if (body.message) await appendMessage(conversationId, 'user', { text: body.message }, db);
  const history = toAgentMessages(await getMessages(conversationId, db));

  const provider = createAnthropicProvider({ apiKey: cfg.apiKey });
  const loop = runAgent({
    provider,
    model: cfg.model,
    system: buildSystemPrompt(),
    messages: history,
    tools: readTools,
    ctx: { db },
    signal: req.signal,
  });

  const encoder = new TextEncoder();
  let assistantText = '';
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(sseEncode({ type: 'conversation', conversationId })));
      for await (const e of loop) {
        if (e.type === 'text') assistantText += e.delta;
        controller.enqueue(encoder.encode(sseEncode(e)));
      }
      if (assistantText) await appendMessage(conversationId, 'assistant', { text: assistantText }, db);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
