import type { getDb } from '@/db/client';
import type { ToolSpec } from '@/lib/agent/providers/types';

/**
 * How a tool call is allowed to reach the user. Read tools never mutate
 * anything, so they run with no gate at all; mutating tools must declare
 * how their effect gets confirmed/undone before the registry will run them.
 */
export type Gate = 'none' | 'apply-undo' | 'confirm';

export interface ToolContext {
  db: ReturnType<typeof getDb>;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface Tool {
  spec: ToolSpec;
  gate: Gate;
  run(input: any, ctx: ToolContext): Promise<ToolResult>;
}

export function toToolSpecs(tools: Tool[]): ToolSpec[] {
  return tools.map((t) => t.spec);
}
