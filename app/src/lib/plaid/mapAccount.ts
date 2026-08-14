import type { AccountBase } from 'plaid';
import type { ResolveAccountInput } from '@/lib/accounts';
import { canonicalAccount } from '@/lib/accountName';

/**
 * Plaid account → our account shape, with the name canonicalized.
 *
 * Chase reports every credit card as the literal name "CREDIT CARD", which
 * carries no product information; canonicalLabel reduces that to "Card" and we
 * keep it, paired with the mask, until the user names it. Guessing the product
 * from spending is explicitly out of bounds.
 */
export function mapPlaidAccount(
  acct: AccountBase,
  institutionName: string,
  owner = '',
): ResolveAccountInput {
  const type = acct.type ?? 'unknown';
  const accountClass =
    type === 'investment' || type === 'brokerage' ? 'investment'
    : type === 'loan' ? 'liability'
    : 'spending';
  const canon = canonicalAccount(
    institutionName || 'Bank',
    acct.name || acct.official_name || 'Account',
    { type, subtype: (acct.subtype as string) ?? undefined },
  );
  return {
    institution: canon.institution,
    name: canon.name,
    owner,
    mask: acct.mask ?? null,
    accountClass,
    type,
    subtype: (acct.subtype as string) ?? null,
    origin: 'plaid',
    plaidAccountId: acct.account_id,
  };
}
