import type { Side } from '@/lib/netWorth/side';

export type CatalogGroup = 'cash' | 'investments' | 'property' | 'vehicles' | 'other' | 'debt';

export const ASSET_GROUPS = ['cash', 'investments', 'property', 'vehicles', 'other'] as const;

export interface CatalogItem {
  key: string;
  label: string;
  group: CatalogGroup;
  side: Side;
  accountClass: 'asset' | 'investment' | 'spending' | 'liability';
  subtype: string;
  /** Expected refresh cadence in months. NULL = never nag. */
  reviewIntervalMonths: number | null;
  /** Liabilities only: which asset group the "Secured by" dropdown lists. */
  securedByGroup?: 'property' | 'vehicles' | 'other';
  /** Shown under the value field. Present only where the obvious value is wrong. */
  hint?: string;
}

const asset = (
  key: string, label: string, group: CatalogGroup,
  accountClass: CatalogItem['accountClass'], subtype: string,
  reviewIntervalMonths: number | null, hint?: string,
): CatalogItem => ({ key, label, group, side: 'asset', accountClass, subtype, reviewIntervalMonths, hint });

const debt = (
  key: string, label: string, subtype: string,
  securedByGroup?: CatalogItem['securedByGroup'],
): CatalogItem => ({
  key, label, group: 'debt', side: 'liability', accountClass: 'liability',
  subtype, reviewIntervalMonths: null, securedByGroup,
});

export const CATALOG: CatalogItem[] = [
  asset('checking', 'Checking', 'cash', 'spending', 'checking', 1),
  asset('savings', 'Savings', 'cash', 'spending', 'savings', 1),
  asset('cd', 'Certificate of deposit', 'cash', 'spending', 'cd', 3),
  asset('money_market', 'Money market', 'cash', 'spending', 'money_market', 1),
  asset('cash_on_hand', 'Cash on hand', 'cash', 'spending', 'cash', 3),

  asset('brokerage', 'Brokerage', 'investments', 'investment', 'brokerage', 3),
  asset('workplace_retirement', '401(k) / 403(b)', 'investments', 'investment', '401k', 3,
    'Counted at full balance; deferred income tax is not modeled.'),
  asset('traditional_ira', 'Traditional IRA', 'investments', 'investment', 'ira', 3,
    'Counted at full balance; deferred income tax is not modeled.'),
  asset('roth_ira', 'Roth IRA', 'investments', 'investment', 'roth', 3),
  asset('hsa', 'HSA', 'investments', 'investment', 'hsa', 3),
  asset('five_two_nine', '529 college savings', 'investments', 'investment', '529', 3),
  asset('crypto', 'Crypto', 'investments', 'investment', 'crypto', 1),
  asset('pension', 'Pension', 'investments', 'investment', 'pension', 12,
    'Only include this if your plan reports a lump-sum or present-value figure.'),

  asset('primary_residence', 'Primary residence', 'property', 'asset', 'real_estate', 12),
  asset('rental_property', 'Rental property', 'property', 'asset', 'real_estate', 12),
  asset('land', 'Land', 'property', 'asset', 'real_estate', 12),

  asset('car', 'Car', 'vehicles', 'asset', 'vehicle', 12),
  asset('motorcycle', 'Motorcycle', 'vehicles', 'asset', 'vehicle', 12),
  asset('boat', 'Boat', 'vehicles', 'asset', 'vehicle', 12),
  asset('rv', 'RV', 'vehicles', 'asset', 'vehicle', 12),

  asset('life_insurance_cash_value', 'Life insurance cash value', 'other', 'investment', 'insurance', 12,
    'Enter the cash surrender value, not the death benefit.'),
  asset('business_equity', 'Business equity', 'other', 'asset', 'business', 12),
  asset('collectibles', 'Collectibles, art, jewelry', 'other', 'asset', 'collectible', 12),
  asset('other_asset', 'Other asset', 'other', 'asset', 'other', 12),

  debt('mortgage', 'Mortgage', 'mortgage', 'property'),
  debt('heloc', 'HELOC', 'heloc', 'property'),
  debt('auto_loan', 'Auto loan', 'auto', 'vehicles'),
  debt('student_loan', 'Student loan', 'student'),
  debt('credit_card', 'Credit card', 'credit'),
  debt('personal_loan', 'Personal loan', 'personal'),
  debt('retirement_loan', '401(k) loan', 'retirement_loan'),
  debt('policy_loan', 'Policy loan', 'policy_loan', 'other'),
  debt('medical_debt', 'Medical debt', 'medical'),
  debt('taxes_owed', 'Taxes owed', 'tax'),
  debt('other_liability', 'Other liability', 'other_debt'),
];

export function catalogByKey(key: string): CatalogItem | undefined {
  return CATALOG.find((c) => c.key === key);
}

/**
 * Display group for a stored account subtype.
 *
 * Accounts created before this catalog existed (every Plaid row) carry subtypes
 * the catalog never issued, so this must always return something. Anything with
 * 'credit' or 'loan' in it is debt; anything else unrecognised falls to 'other'.
 */
export function groupForSubtype(subtype: string): CatalogGroup {
  const exact = CATALOG.find((c) => c.subtype === subtype);
  if (exact) return exact.group;
  const s = subtype.toLowerCase();
  if (s.includes('credit') || s.includes('loan') || s.includes('mortgage')) return 'debt';
  if (s.includes('checking') || s.includes('savings') || s.includes('depository')) return 'cash';
  return 'other';
}
