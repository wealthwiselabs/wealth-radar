import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMEvent, LLMRequest, AgentMessage, ToolSpec } from './types';

// Minimal surface we depend on — lets tests inject a fake.
export interface AnthropicLike {
  messages: { stream(params: unknown): AsyncIterable<any> };
}

function toAnthropicMessages(messages: AgentMessage[]) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'user' as const,
        content: [{ type: 'tool_result', tool_use_id: m.toolResult!.id, content: m.toolResult!.content, is_error: m.toolResult!.isError }],
      };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks: unknown[] = [];
      if (m.text) blocks.push({ type: 'text', text: m.text });
      for (const c of m.toolCalls) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
      return { role: 'assistant' as const, content: blocks };
    }
    return { role: m.role as 'user' | 'assistant', content: m.text ?? '' };
  });
}

function toAnthropicTools(tools: ToolSpec[]) {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
}

export function createAnthropicProvider(opts: { apiKey: string; client?: AnthropicLike; }): LLMProvider {
  const client: AnthropicLike = opts.client ?? (new Anthropic({ apiKey: opts.apiKey }) as unknown as AnthropicLike);
  return {
    async *streamChat(req: LLMRequest): AsyncIterable<LLMEvent> {
      const stream = client.messages.stream({
        model: req.model,
        max_tokens: 8192,
        thinking: { type: 'adaptive' },
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        tools: toAnthropicTools(req.tools),
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
