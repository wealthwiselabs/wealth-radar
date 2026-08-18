import type { getDb } from '@/db/client';
import type { ToolSpec } from '@/lib/agent/providers/types';

/**
 * How a tool call is allowed to reach the user. Read tools never mutate
 * anything, so they run with no gate at all; mutating tools must declare
 * how their effect gets confirmed/undone before the registry will run them.
 */
export type Gate = 'none' | 'apply-undo' | 'confirm';

/** Progress a long-running tool reports through the side-channel below. */
export type ProgressEvent =
  | { kind: 'phase'; label: string }
  | { kind: 'fetch'; url: string };

export interface ToolContext {
  db: ReturnType<typeof getDb>;
  /** Identifies the conversation a tool call belongs to, so tools can look up
   * conversation-scoped state (e.g. a staged statement import). Optional for
   * backward compatibility with callers/tests that don't need it. */
  conversationId?: string;
  /** Optional side-channel for a slow tool (e.g. deep_research) to report
   * progress while it runs; the route streams these as SSE `progress` frames so
   * the UI can show "Researching… (N sources)". Undefined for tests/callers that
   * don't wire it. */
  onProgress?: (ev: ProgressEvent) => void;
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
