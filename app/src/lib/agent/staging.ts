// In-memory per-conversation staging area for a classified statement awaiting
// import confirmation. A statement is classified (see /api/classify) before
// the agent has a chance to gate its persistence, so the parsed rows are held
// here — keyed by conversation — until the import_statement tool commits or
// discards them.
import type { PendingTransaction } from '@/types';

export interface StagedStatement {
  fileName: string;
  transactions: PendingTransaction[];
}

const store = new Map<string, StagedStatement>();

export function stageStatement(conversationId: string, s: StagedStatement): void {
  store.set(conversationId, s);
}

export function getStagedStatement(conversationId: string): StagedStatement | undefined {
  return store.get(conversationId);
}

export function clearStagedStatement(conversationId: string): void {
  store.delete(conversationId);
}
