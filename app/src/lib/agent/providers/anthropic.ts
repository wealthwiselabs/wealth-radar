import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMEvent, LLMRequest, AgentMessage, ToolSpec } from './types';

// Minimal surface we depend on — lets tests inject a fake.
export interface AnthropicLike {
  messages: { stream(params: unknown): AsyncIterable<any> };
}

// Anthropic requires tool_use / tool_result ids to match ^[a-zA-Z0-9_-]+$.
// Older histories persisted batch ids containing a '.', which 400s on every
// resend of that conversation. Normalize any illegal char to '_' at the provider
// boundary — applied identically to a tool_use id and its matching tool_result
// id, so the pair stays matched — which also heals already-stored bad ids.
const sanitizeToolId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

export function toAnthropicMessages(messages: AgentMessage[]) {
  const out: { role: 'user' | 'assistant'; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: sanitizeToolId(m.toolResult!.id),
        content: m.toolResult!.content,
        is_error: m.toolResult!.isError,
      };
      // Anthropic requires ALL tool_results for a parallel-tool-use assistant
      // turn in a SINGLE user message. Merge consecutive `tool` rows into the
      // same user message rather than emitting one user message per result
      // (which would be non-alternating and 400).
      const prev = out[out.length - 1];
      if (prev && prev.role === 'user' && Array.isArray(prev.content)) {
        (prev.content as unknown[]).push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks: unknown[] = [];
      if (m.text) blocks.push({ type: 'text', text: m.text });
      for (const c of m.toolCalls) blocks.push({ type: 'tool_use', id: sanitizeToolId(c.id), name: c.name, input: c.input });
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    out.push({ role: m.role as 'user' | 'assistant', content: m.text ?? '' });
  }
  return out;
}

function toAnthropicTools(tools: ToolSpec[]) {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
}

// Anthropic's server-side web search tool. This runs on Anthropic's side (not as
// a client tool the agent loop executes), so it only applies in this provider.
// Tool-type string bound to what the installed SDK supports (WebSearchTool20250305).
const WEB_SEARCH_TOOL = { type: 'web_search_20250305' as const, name: 'web_search' as const, max_uses: 5 };

export function createAnthropicProvider(opts: { apiKey: string; client?: AnthropicLike; }): LLMProvider {
  const client: AnthropicLike = opts.client ?? (new Anthropic({ apiKey: opts.apiKey }) as unknown as AnthropicLike);
  return {
    async *streamChat(req: LLMRequest): AsyncIterable<LLMEvent> {
      const stream = client.messages.stream({
        model: req.model,
        max_tokens: 8192,
        // Adaptive thinking + high effort: the model decides when to think, and
        // effort 'high' sets the depth (the 5-series removed budget_tokens).
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        // Client tools plus Anthropic's server-side web_search tool.
        tools: [...toAnthropicTools(req.tools), WEB_SEARCH_TOOL],
        messages: toAnthropicMessages(req.messages),
      });

      // Accumulate tool_use input JSON per block index.
      const toolBlocks = new Map<number, { id: string; name: string; json: string }>();

      for await (const e of stream) {
        if (req.signal?.aborted) return;
        switch (e.type) {
          case 'content_block_start':
            if (e.content_block?.type === 'tool_use') {
              toolBlocks.set(e.index, { id: e.content_block.id, name: e.content_block.name, json: '' });
            }
            // Server-side tools (web_search) run on Anthropic's side. Their blocks
            // (`server_tool_use` / `web_search_tool_result`) are consumed internally
            // and deliberately NOT tracked in toolBlocks, so they never surface as a
            // `tool_call` for the agent loop to execute as a client tool. The
            // assistant `text` blocks around them keep flowing normally.
            break;
          case 'content_block_delta':
            if (e.delta?.type === 'text_delta') yield { type: 'text', delta: e.delta.text };
            else if (e.delta?.type === 'thinking_delta') yield { type: 'thinking', delta: e.delta.thinking };
            else if (e.delta?.type === 'input_json_delta') {
              const b = toolBlocks.get(e.index);
              if (b) b.json += e.delta.partial_json;
            }
            break;
          case 'content_block_stop': {
            const b = toolBlocks.get(e.index);
            if (b) {
              yield { type: 'tool_call', id: b.id, name: b.name, input: b.json ? JSON.parse(b.json) : {} };
              toolBlocks.delete(e.index);
            }
            break;
          }
          case 'message_delta': {
            const reason = e.delta?.stop_reason;
            const stopReason = reason === 'tool_use' ? 'tool_use' : reason === 'max_tokens' ? 'length' : reason === 'refusal' ? 'refusal' : 'end';
            yield { type: 'done', stopReason };
            break;
          }
        }
      }
    },
  };
}
