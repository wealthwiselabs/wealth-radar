import { describe, it, expect } from 'vitest';
import { toAnthropicMessages } from '@/lib/agent/providers/anthropic';
import type { AgentMessage } from '@/lib/agent/providers/types';

const ID_RE = /^[a-zA-Z0-9_-]+$/;

describe('toAnthropicMessages — batched parallel tool results', () => {
  it('merges consecutive tool results into ONE user message', () => {
    const messages: AgentMessage[] = [
      { role: 'user', text: 'edit two files' },
      {
        role: 'assistant',
        text: 'doing it',
        toolCalls: [
          { id: 't_0', name: 'edit_file', input: { path: 'a' } },
          { id: 't_1', name: 'edit_file', input: { path: 'b' } },
        ],
      },
      { role: 'tool', toolResult: { id: 't_0', content: 'ok a' } },
      { role: 'tool', toolResult: { id: 't_1', content: 'ok b' } },
    ];

    const out = toAnthropicMessages(messages);

    // Find the assistant turn, then assert exactly ONE user message follows it.
    const assistantIdx = out.findIndex((m) => m.role === 'assistant');
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    const after = out.slice(assistantIdx + 1);
    expect(after).toHaveLength(1);

    const merged = after[0];
    expect(merged.role).toBe('user');
    expect(Array.isArray(merged.content)).toBe(true);

    const blocks = merged.content as any[];
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.type === 'tool_result')).toBe(true);
    expect(blocks.map((b) => b.tool_use_id)).toEqual(['t_0', 't_1']);

    // Every id used (tool_use and tool_result) must match Anthropic's pattern.
    for (const b of blocks) expect(b.tool_use_id).toMatch(ID_RE);
    const asstBlocks = out[assistantIdx].content as any[];
    for (const b of asstBlocks.filter((x) => x.type === 'tool_use')) {
      expect(b.id).toMatch(ID_RE);
    }
  });
});
