import { NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { runAgent, type LoopEvent } from '@/lib/agent/loop';
import { createProvider } from '@/lib/agent/providers';
import { readTools } from '@/lib/agent/tools/read';
import { writeTools } from '@/lib/agent/tools/write';
import { loadKnowledgeTool } from '@/lib/agent/tools/knowledge';
import { makeSpawnTaskTool } from '@/lib/agent/tools/spawn';
import { makeDeepResearchTool } from '@/lib/agent/tools/research';
import { saveMemoryTool } from '@/lib/agent/tools/memory';
import { webTools } from '@/lib/agent/tools/web';
import type { Tool, ToolContext } from '@/lib/agent/tools/types';
import { buildSystemPrompt, resolveAgentConfig, type AgentConfig } from '@/lib/agent/systemPrompt';
import { createConversation, appendMessage, getMessages } from '@/lib/agent/conversations';
import { getAllMemory, formatMemoryForPrompt } from '@/lib/agent/memory';
import { readTaxonomy } from '@/lib/storage';
import { trimHistory } from '@/lib/agent/history';
import type { AgentMessage } from '@/lib/agent/providers/types';
import { formatViewContext } from '@/app/lib/viewContext';
import { stageStatement } from '@/lib/agent/staging';
import type { PendingTransaction } from '@/types';
import { sseEncode } from './sse';

/**
 * Build a compact system-prompt note describing a just-staged statement so the
 * model can answer questions about it and knows how to import it. Kept short:
 * a header line (file, count, date range, gross total), up to ~10 sample rows,
 * and the import instruction.
 */
function formatAttachmentNote(a: { fileName: string; transactions: PendingTransaction[] }): string {
  const txns = a.transactions;
  const n = txns.length;
  const dates = txns.map((t) => t.date).filter(Boolean).sort();
  const range = dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : 'no dates';
  const gross = txns.reduce((sum, t) => sum + t.amount, 0);
  const sample = txns
    .slice(0, 10)
    .map((t) => `${t.date} | ${t.description} | ${t.amount}`)
    .join('\n');
  const lines = [
    `A statement "${a.fileName}" is staged with ${n} transaction(s), dates ${range}, gross total ${gross.toFixed(2)}.`,
  ];
  if (sample) lines.push(`Sample rows:\n${sample}`);
  lines.push('Call import_statement to import these if the user asks.');
  return lines.join('\n');
}

/**
 * Append a delimited note to a system prompt for a single turn. Kept generic so
 * later tasks can reuse it for other per-turn notes; the tag simply frames the
 * note for the model. Returns the prompt unchanged when the note is empty.
 *
 * Not `export`ed: a Next.js route module may only export route handlers, so an
 * extra export trips the generated-types check. A later task that needs it
 * elsewhere should lift it into a shared module.
 */
function withContextNote(system: string, note: string): string {
  return note ? `${system}\n\n<current_view>\n${note}\n</current_view>` : system;
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
const allTools: Tool[] = [...readTools, ...writeTools, ...webTools, loadKnowledgeTool, saveMemoryTool];
const byName = new Map(allTools.map((t) => [t.spec.name, t]));

// Proposals that are awaiting an explicit approve/deny. A gated tool's `run`
// only ever executes through the approve path below — never from the loop — so
// nothing mutates without the user's decision. A single module-level Map keyed
// by proposal token is adequate for this single-user local app; a globalThis
// singleton keeps it stable across Next.js route-module reloads in dev.
//
// One parked entry may hold MANY calls: a single gated call parks a one-element
// `calls` array; a batch (≥2 gated calls in one turn) parks all of them under one
// token so a single Approve runs the lot. Each call carries its own `token` (the
// id used for its persisted tool_call and matching tool_result); the single-call
// case reuses the proposal token as that id.
type PendingCall = { token?: string; toolName: string; input: unknown };
type PendingProposal = { conversationId: string; calls: PendingCall[] };
const pending: Map<string, PendingProposal> =
  ((globalThis as any).__agentPending ??= new Map<string, PendingProposal>());

// Per-conversation "don't ask again" grants: tool names the user approved with
// scope 'always'. Threaded into runAgent as `grantedTools` so a gated call whose
// name is in the set runs directly on subsequent turns. Same globalThis-singleton
// treatment as `pending` for dev route-reload stability.
const grants: Map<string, Set<string>> =
  ((globalThis as any).__agentGrants ??= new Map<string, Set<string>>());

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
        // One-element parked entry; the call reuses the proposal token as its id.
        pending.set(e.token, {
          conversationId,
          calls: [{ token: e.token, toolName: e.toolName, input: e.input }],
        });
        controller.enqueue(encoder.encode(sseEncode(e)));
        return;
      }
      if (e.type === 'proposal_batch') {
        // Persist ONE assistant turn whose toolCalls are ALL of the batched calls
        // (one id per call, derived from the batch token). The matching
        // tool_results are appended on the approve/deny path using these same ids.
        const calls: PendingCall[] = e.calls.map((c, i) => ({
          token: `${e.token}_${i}`,
          toolName: c.toolName,
          input: c.input,
        }));
        await appendMessage(
          conversationId,
          'assistant',
          {
            text: assistantText || undefined,
            toolCalls: calls.map((c) => ({ id: c.token!, name: c.toolName, input: c.input })),
          },
          db,
        );
        pending.set(e.token, { conversationId, calls });
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
  taxonomyText: string,
  note: string,
  conversationId: string,
  grantedTools?: Set<string>,
) {
  const provider = createProvider(cfg);
  return runAgent({
    provider,
    model: cfg.model,
    system: withContextNote(buildSystemPrompt(memoryText, taxonomyText), note),
    messages: history,
    tools: [
      ...allTools,
      makeSpawnTaskTool({ provider, model: cfg.model }),
      makeDeepResearchTool({ provider, model: cfg.model }),
    ],
    // conversationId lets conversation-scoped tools (e.g. import_statement) read
    // the staged statement for THIS conversation.
    ctx: { db, conversationId },
    // Tools the user approved with "don't ask again" run directly this turn.
    grantedTools,
    signal,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const cfg = resolveAgentConfig(req.headers, process.env as Record<string, string | undefined>);
  if (!cfg.apiKey) return new Response('No API key configured', { status: 401 });
  const db = getDb();
  const memoryText = formatMemoryForPrompt(await getAllMemory(db));
  // Give the model the exact taxonomy ids so it never invents category/subcategory
  // ids (write tools also validate, but this prevents the wasted round-trip).
  const taxonomyText = (await readTaxonomy()).categories
    .map((c) => `${c.id} (${c.name}): ${c.subcategories.map((s) => `${s.id} (${s.name})`).join(', ')}`)
    .join('\n');
  // Compact snapshot of the page the user is looking at, sent by the chat panel.
  // Absent on the action-resume path (respond() sends no viewContext), in which
  // case this is '' and the system prompt is left unchanged.
  const viewNote = formatViewContext(body.viewContext ?? null);

  const sseHeaders = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };

  // --- Action resume path: an explicit approve/deny of a parked proposal. ---
  if (body.action) {
    const { token, decision, value, scope } = body.action as {
      token: string;
      decision: 'approve' | 'deny';
      value?: unknown;
      scope?: 'once' | 'always';
    };
    // Consume the token SYNCHRONOUSLY, before any await. A duplicate request
    // (double-click, client retry) then finds no pending entry and is rejected,
    // so a gated mutation can never run twice from one approval (no TOCTOU race).
    const p = pending.get(token);
    if (!p) return new Response('Unknown or expired proposal', { status: 400 });
    pending.delete(token);
    const conversationId = p.conversationId;

    if (decision === 'approve') {
      // Run EVERY parked call in order. A single-call proposal is just
      // calls.length === 1, so this covers both the old single path and batches.
      for (const call of p.calls) {
        const callId = call.token ?? token;
        const tool = byName.get(call.toolName);
        if (!tool) {
          await appendMessage(
            conversationId,
            'tool',
            { toolResult: { id: callId, content: `Unknown tool ${call.toolName}`, isError: true } },
            db,
          );
          continue;
        }
        // The optional value override only makes sense for a single-call
        // proposal (e.g. an edited confirm); a batch runs each call's own input.
        const input = p.calls.length === 1 && value !== undefined ? value : call.input;
        // The ONLY place a gated tool's run() executes: an explicit approval.
        try {
          // conversationId so a conversation-scoped tool (import_statement) can
          // read the statement staged for this conversation on the approve path.
          const res = await tool.run(input, { db, conversationId });
          await appendMessage(
            conversationId,
            'tool',
            { toolResult: { id: callId, content: res.content, isError: res.isError } },
            db,
          );
        } catch (err) {
          await appendMessage(
            conversationId,
            'tool',
            { toolResult: { id: callId, content: `Error: ${String(err)}`, isError: true } },
            db,
          );
        }
        // "Don't ask again": grant this tool for the rest of the conversation.
        if (scope === 'always') {
          let set = grants.get(conversationId);
          if (!set) { set = new Set<string>(); grants.set(conversationId, set); }
          set.add(call.toolName);
        }
      }
    } else {
      // Decline: one synthetic tool_result per parked call keeps history
      // well-formed (each tool_use gets a matching tool_result).
      for (const call of p.calls) {
        const callId = call.token ?? token;
        await appendMessage(
          conversationId,
          'tool',
          { toolResult: { id: callId, content: 'User declined.', isError: false } },
          db,
        );
      }
    }

    const history = toAgentMessages(await getMessages(conversationId, db));
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(sseEncode({ type: 'conversation', conversationId })));
        try {
          await pumpLoop(newLoop(trimHistory(history), cfg, db, req.signal, memoryText, taxonomyText, viewNote, conversationId, grants.get(conversationId)), controller, encoder, conversationId, db);
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
      // One synthetic tool_result per parked call (a batch parks many).
      for (const call of p.calls) {
        await appendMessage(
          conversationId,
          'tool',
          { toolResult: { id: call.token ?? token, content: 'User moved on without confirming.', isError: false } },
          db,
        );
      }
      pending.delete(token);
    }
    await appendMessage(conversationId, 'user', { text: body.message }, db);
  }
  const history = toAgentMessages(await getMessages(conversationId, db));

  // Vision content for THIS turn only — NOT persisted (mirrors reasoning). Attach
  // to the last user message of the in-memory history so the provider sees it now.
  // Guardrails: at most 4 images and ~8MB of total base64; otherwise drop silently.
  const rawImages = body.images as { mediaType: string; data: string }[] | undefined;
  if (Array.isArray(rawImages) && rawImages.length > 0) {
    const totalBytes = rawImages.reduce((sum, img) => sum + (img?.data?.length ?? 0), 0);
    if (rawImages.length <= 4 && totalBytes <= 8 * 1024 * 1024) {
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'user') {
          history[i].images = rawImages;
          break;
        }
      }
    }
  }

  // A chat-panel attachment stages a classified statement for THIS turn. Stage
  // it (keyed by conversationId so import_statement can find it) and fold a
  // compact summary into the per-turn note alongside the existing view note.
  const attachment = body.attachment as
    | { fileName: string; transactions: PendingTransaction[] }
    | undefined;
  if (attachment) stageStatement(conversationId, attachment);
  const note = [viewNote, attachment ? formatAttachmentNote(attachment) : '']
    .filter(Boolean)
    .join('\n\n');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(sseEncode({ type: 'conversation', conversationId })));
      try {
        await pumpLoop(newLoop(trimHistory(history), cfg, db, req.signal, memoryText, taxonomyText, note, conversationId, grants.get(conversationId)), controller, encoder, conversationId, db);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders });
}
