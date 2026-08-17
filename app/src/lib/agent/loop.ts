import { randomUUID } from 'crypto';
import type { LLMProvider, AgentMessage } from './providers/types';
import type { Tool, ToolContext } from './tools/types';

export type LoopEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_start'; name: string }
  | { type: 'proposal'; token: string; toolName: string; input: unknown }
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

    for (const call of calls) {
      const tool = byName.get(call.name);
      if (!tool) { messages.push({ role: 'tool', toolResult: { id: call.id, content: `Unknown tool ${call.name}`, isError: true } }); continue; }
      if (tool.gate !== 'none') {
        // Gated: stop and hand the decision to the user. Do NOT mutate.
        yield { type: 'proposal', token: randomUUID(), toolName: call.name, input: call.input };
        return;
      }
      yield { type: 'tool_start', name: call.name };
      try {
        const res = await tool.run(call.input, opts.ctx);
        messages.push({ role: 'tool', toolResult: { id: call.id, content: res.content, isError: res.isError } });
      } catch (err) {
        messages.push({ role: 'tool', toolResult: { id: call.id, content: `Error: ${String(err)}`, isError: true } });
      }
    }
  }
  yield { type: 'done' };
}
