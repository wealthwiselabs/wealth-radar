import type { AccountRow } from '@/lib/accounts';

export type Side = 'asset' | 'liability' | 'excluded';

export type SideInput = Pick<AccountRow, 'accountClass' | 'type'>;

/**
 * Which side of the balance sheet an account sits on.
 *
 * Deliberately derived rather than stored. Plaid maps credit cards to
 * accountClass 'spending' (mapAccount.ts), and that classification is what the
 * Home spending charts filter on — so reclassifying cards to 'liability' to make
 * net worth easier would silently change what counts as spending. Rule 2 below
 * is the whole reason this function exists.
 */
export function netWorthSide(a: SideInput): Side {
  if (a.accountClass === 'liability') return 'liability';
  if (a.accountClass === 'spending' && a.type === 'credit') return 'liability';
  if (a.accountClass === 'spending') return 'asset';
  if (a.accountClass === 'investment' || a.accountClass === 'asset') return 'asset';
  return 'excluded';
}
