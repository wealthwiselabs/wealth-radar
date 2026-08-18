import { randomUUID } from 'crypto';
import type { LLMProvider, AgentMessage } from './providers/types';
import type { Tool, ToolContext } from './tools/types';
import type { UIAffordance } from './ui';

export type LoopEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_start'; name: string }
  | { type: 'proposal'; token: string; toolName: string; input: unknown; affordance: UIAffordance }
  | { type: 'proposal_batch'; token: string; calls: { toolName: string; input: unknown }[]; affordance: UIAffordance }
  | { type: 'done' };

export interface RunAgentOpts {
  provider: LLMProvider;
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: Tool[];
  ctx: ToolContext;
  maxIterations?: number;
  signal?: AbortSignal;
  /** Gated tools whose calls should run directly without a proposal, like gate:'none'. */
  grantedTools?: Set<string>;
}

export async function* runAgent(opts: RunAgentOpts): AsyncIterable<LoopEvent> {
  const byName = new Map(opts.tools.map((t) => [t.spec.name, t]));
  const messages = [...opts.messages];
  const specs = opts.tools.map((t) => t.spec);
  const max = opts.maxIterations ?? 8;

  for (let iter = 0; iter < max; iter++) {
    let assistantText = '';
    const calls: { id: string; name: string; input: unknown }[] = [];
    let stop: string = 'end';

    for await (const e of opts.provider.streamChat({ system: opts.system, messages, tools: specs, model: opts.model, signal: opts.signal })) {
      if (e.type === 'text') { assistantText += e.delta; yield { type: 'text', delta: e.delta }; }
      else if (e.type === 'thinking') yield { type: 'thinking', delta: e.delta };
      else if (e.type === 'tool_call') calls.push({ id: e.id, name: e.name, input: e.input });
      else if (e.type === 'done') stop = e.stopReason;
    }

    if (stop !== 'tool_use' || calls.length === 0) { yield { type: 'done' }; return; }

    // Record the assistant turn (text + tool calls) before results.
    messages.push({ role: 'assistant', text: assistantText || undefined, toolCalls: calls });

    // Run non-gated (and granted) calls first; collect the rest as gated.
    const gated: { id: string; name: string; input: unknown; tool: Tool }[] = [];
    for (const call of calls) {
      const tool = byName.get(call.name);
      if (!tool) { messages.push({ role: 'tool', toolResult: { id: call.id, content: `Unknown tool ${call.name}`, isError: true } }); continue; }
      const granted = opts.grantedTools?.has(tool.spec.name) ?? false;
      if (tool.gate !== 'none' && !granted) { gated.push({ ...call, tool }); continue; }
      // Non-gated, or gated-but-granted: run directly.
      yield { type: 'tool_start', name: call.name };
      try {
        const res = await tool.run(call.input, opts.ctx);
        messages.push({ role: 'tool', toolResult: { id: call.id, content: res.content, isError: res.isError } });
      } catch (err) {
        messages.push({ role: 'tool', toolResult: { id: call.id, content: `Error: ${String(err)}`, isError: true } });
      }
    }

    if (gated.length === 1) {
      // Single gated call: stop and hand the decision to the user. Do NOT mutate.
      const call = gated[0];
      const token = randomUUID();
      const p = call.tool.preview
        ? await call.tool.preview(call.input, opts.ctx)
        : { title: `Confirm ${call.name}?`, diff: { summary: JSON.stringify(call.input) }, confirmLabel: 'Confirm' };
      yield {
        type: 'proposal',
        token,
        toolName: call.name,
        input: call.input,
        affordance: { kind: 'confirm', token, title: p.title, diff: p.diff, confirmLabel: p.confirmLabel },
      };
      return;
    }

    if (gated.length >= 2) {
      // Multiple gated calls: batch them into a single confirmation. Do NOT mutate.
      const token = randomUUID();
      const items: { summary: string }[] = [];
      for (const call of gated) {
        if (call.tool.preview) {
          const p = await call.tool.preview(call.input, opts.ctx);
          items.push({ summary: p.diff.summary });
        } else {
          items.push({ summary: `Confirm ${call.name}` });
        }
      }
      yield {
        type: 'proposal_batch',
        token,
        calls: gated.map((c) => ({ toolName: c.name, input: c.input })),
        affordance: { kind: 'confirm_batch', token, title: `Confirm ${gated.length} actions`, items, confirmLabel: 'Confirm all' },
      };
      return;
    }
  }
  yield { type: 'done' };
}
