import { NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { runAgent, type LoopEvent } from '@/lib/agent/loop';
import { createProvider } from '@/lib/agent/providers';
import { readTools } from '@/lib/agent/tools/read';
import { writeTools } from '@/lib/agent/tools/write';
import { loadKnowledgeTool } from '@/lib/agent/tools/knowledge';
import { makeSpawnTaskTool } from '@/lib/agent/tools/spawn';
import { saveMemoryTool } from '@/lib/agent/tools/memory';
import type { Tool, ToolContext } from '@/lib/agent/tools/types';
import { buildSystemPrompt, resolveAgentConfig, type AgentConfig } from '@/lib/agent/systemPrompt';
import { createConversation, appendMessage, getMessages } from '@/lib/agent/conversations';
import { getAllMemory, formatMemoryForPrompt } from '@/lib/agent/memory';
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

// The single registry of tools the route exposes to the agent. Task 11 appends
// gated write tools here; keeping it as one list means that change is one line
// and the approve path below resolves any tool by name.
const allTools: Tool[] = [...readTools, ...writeTools, loadKnowledgeTool, saveMemoryTool];
const byName = new Map(allTools.map((t) => [t.spec.name, t]));

// Proposals that are awaiting an explicit approve/deny. A gated tool's `run`
// only ever executes through the approve path below — never from the loop — so
// nothing mutates without the user's decision. A single module-level Map keyed
// by proposal token is adequate for this single-user local app; a globalThis
// singleton keeps it stable across Next.js route-module reloads in dev.
type PendingProposal = { toolName: string; input: unknown; conversationId: string };
const pending: Map<string, PendingProposal> =
  ((globalThis as any).__agentPending ??= new Map<string, PendingProposal>());

/**
 * Drive one agent loop, streaming its events to the SSE controller while
 * persisting the assistant's turn. On a `proposal` (a gated tool the loop
 * refused to run), persist the assistant's tool-call turn, register the pending
 * proposal, stream it, and stop — the loop has already returned without
 * mutating anything.
 */
async function pumpLoop(
  loop: AsyncIterable<LoopEvent>,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  conversationId: string,
  db: ToolContext['db'],
): Promise<void> {
  let assistantText = '';
  try {
    for await (const e of loop) {
      if (e.type === 'text') assistantText += e.delta;
      if (e.type === 'proposal') {
        // Persist ONE assistant turn combining any prose that preceded the tool
        // call with the tool call itself — matching the loop's own message shape.
        // Splitting these into two consecutive assistant rows would break resume:
        // the Anthropic API rejects non-alternating same-role messages.
        await appendMessage(
          conversationId,
          'assistant',
          { text: assistantText || undefined, toolCalls: [{ id: e.token, name: e.toolName, input: e.input }] },
          db,
        );
        pending.set(e.token, { toolName: e.toolName, input: e.input, conversationId });
        controller.enqueue(encoder.encode(sseEncode(e)));
        return;
      }
      controller.enqueue(encoder.encode(sseEncode(e)));
    }
    if (assistantText) await appendMessage(conversationId, 'assistant', { text: assistantText }, db);
  } catch (err: any) {
    // A provider throw mid-stream (network, bad model id, a malformed-history
    // 400) would otherwise unwind into the ReadableStream's `start()`, whose
    // `finally` only closes the stream — the response is already `200`, so the
    // client sees a clean EOF and no error. Persist whatever text accumulated,
    // then signal the failure explicitly so the hook can surface it.
    if (assistantText) await appendMessage(conversationId, 'assistant', { text: assistantText }, db);
    controller.enqueue(encoder.encode(sseEncode({ type: 'error', message: String(err?.message ?? err) })));
  }
}

function newLoop(
  history: AgentMessage[],
  cfg: AgentConfig,
  db: ToolContext['db'],
  signal: AbortSignal,
  memoryText: string,
) {
  const provider = createProvider(cfg);
  return runAgent({
    provider,
    model: cfg.model,
    system: buildSystemPrompt(memoryText),
    messages: history,
    tools: [...allTools, makeSpawnTaskTool({ provider, model: cfg.model })],
    ctx: { db },
    signal,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const cfg = resolveAgentConfig(req.headers, process.env as Record<string, string | undefined>);
  if (!cfg.apiKey) return new Response('No API key configured', { status: 401 });
  const db = getDb();
  const memoryText = formatMemoryForPrompt(await getAllMemory(db));

  const sseHeaders = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };

  // --- Action resume path: an explicit approve/deny of a parked proposal. ---
  if (body.action) {
    const { token, decision, value } = body.action as {
      token: string;
      decision: 'approve' | 'deny';
      value?: unknown;
    };
    // Consume the token SYNCHRONOUSLY, before any await. A duplicate request
    // (double-click, client retry) then finds no pending entry and is rejected,
    // so a gated mutation can never run twice from one approval (no TOCTOU race).
    const p = pending.get(token);
    if (!p) return new Response('Unknown or expired proposal', { status: 400 });
    pending.delete(token);
    const conversationId = p.conversationId;

    if (decision === 'approve') {
      const tool = byName.get(p.toolName);
      if (!tool) {
        return new Response(`Unknown tool ${p.toolName}`, { status: 400 });
      }
      // The ONLY place a gated tool's run() executes: an explicit approval.
      const input = value !== undefined ? value : p.input;
      try {
        const res = await tool.run(input, { db });
        await appendMessage(
          conversationId,
          'tool',
          { toolResult: { id: token, content: res.content, isError: res.isError } },
          db,
        );
      } catch (err) {
        await appendMessage(
          conversationId,
          'tool',
          { toolResult: { id: token, content: `Error: ${String(err)}`, isError: true } },
          db,
        );
      }
    } else {
      await appendMessage(
        conversationId,
        'tool',
        { toolResult: { id: token, content: 'User declined.', isError: false } },
        db,
      );
    }

    const history = toAgentMessages(await getMessages(conversationId, db));
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(sseEncode({ type: 'conversation', conversationId })));
        try {
          await pumpLoop(newLoop(history, cfg, db, req.signal, memoryText), controller, encoder, conversationId, db);
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: sseHeaders });
  }

  // --- Initial-message path: a new user turn. ---
  const conversationId: string = body.conversationId || (await createConversation('', db));
  if (body.message) {
    // If the user ignored a confirm card and just typed a new message, the last
    // stored assistant turn is a dangling tool_use (the parked proposal) with no
    // matching tool_result. Appending a user turn onto that produces
    // assistant(tool_use) → user(text), which BOTH the Anthropic and OpenAI APIs
    // reject — wedging every subsequent turn until a page reload. Auto-resolve
    // any proposals parked for THIS conversation with a synthetic tool_result
    // BEFORE appending the user turn, so the history stays well-formed
    // (assistant(tool_use) → tool(result) → user(text)). The explicit approve/deny
    // path above consumes its own token, so this only ever fires for abandoned cards.
    for (const [token, p] of pending) {
      if (p.conversationId !== conversationId) continue;
      await appendMessage(
        conversationId,
        'tool',
        { toolResult: { id: token, content: 'User moved on without confirming.', isError: false } },
        db,
      );
      pending.delete(token);
    }
    await appendMessage(conversationId, 'user', { text: body.message }, db);
  }
  const history = toAgentMessages(await getMessages(conversationId, db));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(sseEncode({ type: 'conversation', conversationId })));
      try {
        await pumpLoop(newLoop(history, cfg, db, req.signal, memoryText), controller, encoder, conversationId, db);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
}
