function titleCase(s: string): string {
  return s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const INSTITUTIONS: Array<[RegExp, string]> = [
  [/jpmorgan|chase/i, 'Chase'],
  [/american express|amex/i, 'Amex'],
  [/citibank|citi/i, 'Citi'],
  // "U.S. Bancorp Advisors/Investments" is the brokerage arm — its statements never
  // say "U.S. Bank", so without bancorp here they cannot match the US Bank accounts.
  [/u\.?\s?s\.? ban(k|corp)|usbank|usbancorp/i, 'US Bank'],
  [/bank of america|bofa/i, 'BofA'],
  [/wells fargo/i, 'Wells Fargo'],
  [/vanguard/i, 'Vanguard'],
  [/fidelity/i, 'Fidelity'],
  [/schwab/i, 'Schwab'],
];
export function canonicalInstitution(raw: string): string {
  const r = raw || '';
  for (const [re, name] of INSTITUTIONS) if (re.test(r)) return name;
  const cleaned = titleCase(r.replace(/,?\s*n\.?\s?a\.?/ig, ' ').replace(/\bbank\b/ig, ' ').replace(/[^a-z0-9 ]/ig, ' '));
  return cleaned || 'Bank';
}

// Card products first (a co-brand like "Delta ... Platinum" must resolve to Delta, not Platinum).
const PRODUCTS: Array<[RegExp, string]> = [
  [/sapphire reserve/i, 'Sapphire Reserve'], [/sapphire/i, 'Sapphire'],
  [/freedom unlimited/i, 'Freedom Unlimited'], [/freedom flex/i, 'Freedom Flex'], [/freedom/i, 'Freedom'],
  [/delta/i, 'Delta'], [/united|mileageplus/i, 'United'], [/southwest|rapid rewards/i, 'Southwest'],
  [/\bihg\b/i, 'IHG'], [/hilton.*aspire/i, 'Hilton Aspire'], [/hilton/i, 'Hilton'],
  [/marriott|bonvoy/i, 'Marriott'], [/amazon/i, 'Amazon'],
  [/platinum/i, 'Platinum'], [/\bgold\b/i, 'Gold'], [/\bgreen\b/i, 'Green'],
];
const LOANS: Array<[RegExp, string]> = [[/mortgage/i, 'Mortgage'], [/student/i, 'Student Loan'], [/auto/i, 'Auto Loan']];
const INVESTMENT: Array<[RegExp, string]> = [
  [/401\s?k/i, '401k'], [/roth/i, 'Roth IRA'], [/\bira\b/i, 'IRA'], [/\b529\b/i, '529'],
  [/hsa/i, 'HSA'], [/brokerage/i, 'Brokerage'], [/\bcd\b/i, 'CD'],
];
const DEPOSITORY: Array<[RegExp, string]> = [
  // checking BEFORE saving so "Checking & Savings" (a combined-statement name) → Checking, not Saving.
  [/money market/i, 'Money Market'], [/checking/i, 'Checking'], [/saving/i, 'Saving'],
  [/\bcd\b/i, 'CD'], [/\bhsa\b/i, 'HSA'], [/cash management/i, 'Cash Mgmt'],
];
export function canonicalLabel(rawName: string, opts?: { type?: string; subtype?: string }): string {
  const type = (opts?.type || '').toLowerCase();
  const hay = `${rawName || ''} ${opts?.subtype || ''} ${opts?.type || ''}`;
  // When Plaid gives us an authoritative account type, prefer the type-appropriate
  // label before card products — otherwise a depository/loan/investment account whose
  // name contains a card-tier word (e.g. "Green Rewards Checking") gets mislabeled.
  if (type === 'depository') { for (const [re, l] of DEPOSITORY) if (re.test(hay)) return l; }
  else if (type === 'loan') { for (const [re, l] of LOANS) if (re.test(hay)) return l; }
  else if (type === 'investment') { for (const [re, l] of INVESTMENT) if (re.test(hay)) return l; }
  // credit / unknown / no type (e.g. PDF accounts) → products first (co-brand wins), then loans, then depository.
  for (const [re, l] of PRODUCTS) if (re.test(hay)) return l;
  for (const [re, l] of LOANS) if (re.test(hay)) return l;
  for (const [re, l] of DEPOSITORY) if (re.test(hay)) return l;
  const cleaned = titleCase((rawName || '')
    .replace(/\(.*?\)/g, ' ').replace(/credit card/ig, ' ').replace(/[^a-z0-9 ]/ig, ' ').replace(/\s+/g, ' '));
  // A digits-only name is a card number, not a product — US Bank reports some
  // cards as a bare "3117". Fall back to the generic label so the account gets
  // flagged as needing a name and the mask disambiguates it in the display,
  // rather than showing an account literally called "3117".
  if (!cleaned || /^\d+$/.test(cleaned)) return 'Card';
  return cleaned;
}

export function canonicalAccount(institution: string, name: string, opts?: { type?: string; subtype?: string }) {
  return { institution: canonicalInstitution(institution), name: canonicalLabel(name, opts) };
}
export function accountMatchKey(institution: string, name: string, opts?: { type?: string; subtype?: string }): string {
  const c = canonicalAccount(institution, name, opts);
  return `${c.institution}|${c.name}`.toLowerCase();
}

export interface AcctForMerge { id: string; institution: string; name: string; txnCount: number; type?: string; subtype?: string | null; }
export function proposeMerges(list: AcctForMerge[]) {
  const groups = new Map<string, AcctForMerge[]>();
  for (const a of list) {
    const k = accountMatchKey(a.institution, a.name, { type: a.type, subtype: a.subtype ?? undefined });
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(a);
  }
  const proposals: Array<{ targetId: string; sourceIds: string[]; key: string; names: string[]; canonical: { institution: string; name: string } }> = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => b.txnCount - a.txnCount);
    proposals.push({
      key, targetId: sorted[0].id, sourceIds: sorted.slice(1).map((m) => m.id),
      names: members.map((m) => `${m.institution} / ${m.name}`),
      canonical: canonicalAccount(sorted[0].institution, sorted[0].name, { type: sorted[0].type, subtype: sorted[0].subtype ?? undefined }),
    });
  }
  return proposals;
}
