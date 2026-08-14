import type { AccountRow } from '@/lib/accounts';

// Kept in lockstep with `@/lib/investments/purpose`'s PURPOSES — this copy gates
// the account PATCH/create routes (allowed values a user may set on an account),
// that one gates the investment value/allocation math. Both must list `education`.
export const PURPOSES = ['portfolio', 'reserve', 'insurance', 'education'] as const;
export type Purpose = typeof PURPOSES[number];

export interface AccountPatchBody {
  name?: string;
  owner?: string;
  status?: 'active' | 'closed';
  closedAtMonth?: string | null;
  purpose?: Purpose;
}

/**
 * Pure decision function: given the existing account row and a PATCH body,
 * compute the fields to persist. Kept side-effect free (no DB, no
 * NextRequest) so it can be unit-tested directly — Next.js route modules
 * are only allowed to export HTTP method handlers, so this logic lives in
 * its own module rather than in `route.ts`.
 *
 * Lifecycle rules:
 * - Closing (`status: 'closed'`) with no explicit `closedAtMonth` and no
 *   existing `closedAtMonth` defaults it to the current month, so the
 *   coverage engine (Phase 3b Task 1) stops flagging months after closure.
 * - Reopening (`status: 'active'`) always clears `closedAtMonth` to null.
 */
export function applyAccountPatch(
  existing: AccountRow,
  body: AccountPatchBody,
): Pick<AccountRow, 'name' | 'owner' | 'nameSource' | 'purpose' | 'status' | 'closedAtMonth' | 'modifiedAt'> {
  const now = new Date().toISOString();
  const status = body.status ?? existing.status;

  let closedAtMonth = body.closedAtMonth === undefined ? existing.closedAtMonth : body.closedAtMonth;
  if (body.status === 'closed' && body.closedAtMonth === undefined && !existing.closedAtMonth) {
    closedAtMonth = now.slice(0, 7);
  }
  if (body.status === 'active') {
    closedAtMonth = null;
  }

  return {
    name: body.name ?? existing.name,
    owner: body.owner ?? existing.owner,
    // An explicit rename is user intent and must survive later canonicalization
    // passes (notably scripts/dedupe-accounts.ts), which cannot re-derive names
    // that the bank never supplied — Chase reports every card as "CREDIT CARD".
    nameSource: body.name !== undefined ? 'user' : existing.nameSource,
    purpose: body.purpose ?? existing.purpose,
    status,
    closedAtMonth,
    modifiedAt: now,
  };
}
