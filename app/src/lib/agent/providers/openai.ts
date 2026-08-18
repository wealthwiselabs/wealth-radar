import OpenAI from 'openai';
import type { LLMProvider, LLMEvent, LLMRequest, AgentMessage, ToolSpec } from './types';

// Minimal surface we depend on — lets tests inject a fake, and doubles as the
// OpenAI-compatible surface for locally hosted models via `baseURL`.
export interface OpenAILike {
  chat: { completions: { create(params: any): Promise<AsyncIterable<any>> } };
}

function toMessages(system: string, messages: AgentMessage[]) {
  const out: any[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolResult!.id, content: m.toolResult!.content });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: m.text ?? '',
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input) },
        })),
      });
    } else {
      out.push({ role: m.role, content: m.text ?? '' });
    }
  }
  return out;
}

function toTools(tools: ToolSpec[]) {
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
}

export function createOpenAIProvider(opts: { apiKey: string; baseURL?: string; client?: OpenAILike }): LLMProvider {
  const client: OpenAILike = opts.client ?? (new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL }) as unknown as OpenAILike);
  return {
    async *streamChat(req: LLMRequest): AsyncIterable<LLMEvent> {
      const stream = await client.chat.completions.create({
        model: req.model,
        stream: true,
        messages: toMessages(req.system, req.messages),
        tools: toTools(req.tools),
      });

      // Accumulate tool_call fragments (name/arguments arrive in pieces) by index.
      const calls = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        if (req.signal?.aborted) return;
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) yield { type: 'text', delta: delta.content };
        for (const tc of delta?.tool_calls ?? []) {
          const cur = calls.get(tc.index) ?? { id: tc.id ?? '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(tc.index, cur);
        }
        if (choice?.finish_reason) {
          for (const c of calls.values()) yield { type: 'tool_call', id: c.id, name: c.name, input: c.args ? JSON.parse(c.args) : {} };
          const r = choice.finish_reason;
          yield { type: 'done', stopReason: r === 'tool_calls' ? 'tool_use' : r === 'length' ? 'length' : 'end' };
        }
      }
    },
  };
}
