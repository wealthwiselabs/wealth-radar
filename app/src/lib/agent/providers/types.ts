export type AgentRole = 'user' | 'assistant' | 'tool';

export interface AgentMessage {
  role: AgentRole;
  /** Plain text for user/assistant turns. */
  text?: string;
  /** Assistant tool calls it wants executed. */
  toolCalls?: { id: string; name: string; input: unknown }[];
  /** For role:'tool' — result of a prior call. */
  toolResult?: { id: string; content: string; isError?: boolean };
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema (object)
}

export type LLMEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'done'; stopReason: 'end' | 'tool_use' | 'length' | 'refusal' };

export interface LLMRequest {
  system: string;
  messages: AgentMessage[];
  tools: ToolSpec[];
  model: string;
  signal?: AbortSignal;
}

export interface LLMProvider {
  streamChat(req: LLMRequest): AsyncIterable<LLMEvent>;
}

export async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}
