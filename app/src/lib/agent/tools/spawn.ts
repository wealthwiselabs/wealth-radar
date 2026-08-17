import { runAgent } from '../loop';
import { readTools } from './read';
import { loadKnowledgeTool } from './knowledge';
import type { Tool, ToolContext } from './types';
import type { LLMProvider } from '../providers/types';

export function makeSpawnTaskTool(env: { provider: LLMProvider; model: string }): Tool {
  return {
    gate: 'none',
    spec: {
      name: 'spawn_task',
      description:
        'Run a focused, read-only analysis sub-task (e.g. scan the whole portfolio) and get a summary back. Cannot modify data.',
      inputSchema: {
        type: 'object',
        properties: { goal: { type: 'string' } },
        required: ['goal'],
        additionalProperties: false,
      },
    },
    async run(input: { goal: string }, ctx: ToolContext) {
      let text = '';
      for await (const e of runAgent({
        provider: env.provider,
        model: env.model,
        system: `Focused analysis sub-agent. Goal: ${input.goal}. Read-only. Return a concise summary.`,
        messages: [{ role: 'user', text: input.goal }],
        tools: [...readTools, loadKnowledgeTool],
        ctx,
        maxIterations: 6,
      })) {
        if (e.type === 'text') text += e.delta;
      }
      return { content: text || 'Sub-task produced no output.' };
    },
  };
}
