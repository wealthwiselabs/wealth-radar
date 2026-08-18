import type { AgentMessage } from './providers/types';

// Safety net for very long single conversations: the route sends the ENTIRE
// stored history each turn, so without a cap a long chat eventually exceeds the
// model's context window and 400s. We trim only when the estimated history size
// approaches a 1M-token window — so in practice this almost never fires; it just
// keeps a marathon conversation from hard-failing (start a New chat to reset
// deliberately). Images are transient (current-turn only) and excluded here.

const CONTEXT_WINDOW_TOKENS = 1_000_000;
const OUTPUT_RESERVE = 8_192;       // matches the provider's max_tokens
const OVERHEAD_RESERVE = 40_000;    // system prompt (taxonomy/knowledge/memory) + tools + margin

/** Token budget available to the message history under a 1M-token window. */
export const HISTORY_TOKEN_BUDGET = CONTEXT_WINDOW_TOKENS - OUTPUT_RESERVE - OVERHEAD_RESERVE;

// No tokenizer on hand; ~4 chars/token is the standard rough estimate and only
// needs to be in the right ballpark for a 1M-token guard.
const CHARS_PER_TOKEN = 4;

export function estimateMessageTokens(m: AgentMessage): number {
  let chars = (m.text ?? '').length;
  if (m.toolResult) chars += String(m.toolResult.content ?? '').length + m.toolResult.id.length;
  if (m.toolCalls) {
    for (const c of m.toolCalls) chars += c.name.length + JSON.stringify(c.input ?? {}).length + c.id.length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Drop the OLDEST turns until the estimated history fits `maxTokens`, always
 * keeping the most recent messages (including the current turn). The result is
 * left well-formed for the Anthropic mapping: it begins on a `user` message, so
 * a kept `tool` result is never orphaned from a trimmed `tool_use`, and a
 * dangling leading `assistant(tool_use)` is dropped with its results.
 */
export function trimHistory(messages: AgentMessage[], maxTokens: number = HISTORY_TOKEN_BUDGET): AgentMessage[] {
  const costs = messages.map(estimateMessageTokens);
  const total = costs.reduce((a, b) => a + b, 0);
  if (total <= maxTokens) return messages;

  // Keep as many trailing messages as fit under the budget.
  let suffix = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (suffix + costs[i] > maxTokens) break;
    suffix += costs[i];
    start = i;
  }

  let trimmed = messages.slice(start);
  // Ensure a clean start: skip any leading tool/assistant-tool_use rows so the
  // first kept message is a user turn (no orphaned tool_result on resend).
  let i = 0;
  while (i < trimmed.length && trimmed[i].role !== 'user') i++;
  trimmed = trimmed.slice(i);

  // Never send an empty history — if a single trailing turn is itself over
  // budget there's nothing to trim to; keep the last message and let the
  // provider surface any limit.
  if (trimmed.length === 0) trimmed = messages.slice(-1);
  return trimmed;
}
