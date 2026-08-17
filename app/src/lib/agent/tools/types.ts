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
  /**
   * Optional preview builder for a gated tool. The loop calls this (without
   * running the tool) to describe the pending mutation to the user before they
   * approve or deny it. Never performs the mutation.
   */
  preview?(input: any, ctx: ToolContext): Promise<{ title: string; diff: import('../ui').DiffView; confirmLabel: string }>;
}

export function toToolSpecs(tools: Tool[]): ToolSpec[] {
  return tools.map((t) => t.spec);
}
