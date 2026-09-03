import { describe, it, expect } from 'vitest';
import {
  CATALOG, catalogByKey, groupForSubtype, debtGroupForSubtype, debtGroupFor,
  ASSET_GROUPS, DEBT_GROUPS,
} from '@/lib/netWorth/catalog';

describe('catalog', () => {
  it('has unique keys', () => {
    const keys = CATALOG.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every liability a null review interval', () => {
    // A loan balance is not an estimate — it is synced or read off a statement,
    // so it must never appear in the stale list.
    for (const item of CATALOG.filter((c) => c.side === 'liability')) {
      expect(item.reviewIntervalMonths).toBeNull();
    }
  });

  it('points every securedByGroup at a group that exists on the asset side', () => {
    for (const item of CATALOG.filter((c) => c.securedByGroup)) {
      expect(ASSET_GROUPS).toContain(item.securedByGroup);
    }
  });

  it('gives every asset-side item a valid account class', () => {
    const valid = ['asset', 'investment', 'spending'];
    for (const item of CATALOG.filter((c) => c.side === 'asset')) {
      expect(valid).toContain(item.accountClass);
    }
  });

  it('carries the hints that prevent wrong numbers', () => {
    expect(catalogByKey('life_insurance_cash_value')?.hint).toMatch(/cash surrender value/i);
    expect(catalogByKey('pension')?.hint).toMatch(/lump-sum|present-value/i);
    expect(catalogByKey('traditional_ira')?.hint).toMatch(/deferred|tax/i);
  });

  it('offers a mortgage secured by property and an auto loan secured by vehicles', () => {
    expect(catalogByKey('mortgage')?.securedByGroup).toBe('property');
    expect(catalogByKey('auto_loan')?.securedByGroup).toBe('vehicles');
  });

  it('maps a stored subtype back to its display group', () => {
    expect(groupForSubtype('real_estate')).toBe('property');
    expect(groupForSubtype('vehicle')).toBe('vehicles');
    expect(groupForSubtype('mortgage')).toBe('debt');
    // A subtype from a Plaid account that predates the catalog still resolves.
    expect(groupForSubtype('credit card')).toBe('debt');
    expect(groupForSubtype('nonsense')).toBe('other');
  });

  it('never maps one subtype to two different groups', () => {
    const seen = new Map<string, string>();
    for (const item of CATALOG) {
      const prior = seen.get(item.subtype);
      expect(prior === undefined || prior === item.group).toBe(true);
      seen.set(item.subtype, item.group);
    }
  });

  it('resolves an other-liability subtype to debt, not to an asset group', () => {
    expect(groupForSubtype('other_debt')).toBe('debt');
    expect(groupForSubtype('other')).toBe('other');
  });
});

describe('debtGroupFor', () => {
  it('buckets a Plaid card by its TYPE when subtype is null', () => {
    // Plaid accounts carry no subtype — a card is identified by type 'credit',
    // exactly as netWorthSide already has to handle. Reading subtype alone put
    // every real credit card into "Other debt".
    expect(debtGroupFor({ type: 'credit', subtype: null })).toBe('Credit cards');
    expect(debtGroupFor({ type: 'loan', subtype: null })).toBe('Other debt');
  });

  it('prefers subtype over type when both are present', () => {
    // The catalog's subtype is the more specific signal: an auto loan has
    // type 'loan', and bucketing it as generic debt would lose that.
    expect(debtGroupFor({ type: 'loan', subtype: 'auto' })).toBe('Auto loans');
    expect(debtGroupFor({ type: 'loan', subtype: 'mortgage' })).toBe('Mortgage');
  });
});

describe('debtGroupForSubtype', () => {
  it('buckets each catalog debt subtype into a display group', () => {
    expect(debtGroupForSubtype('mortgage')).toBe('Mortgage');
    expect(debtGroupForSubtype('heloc')).toBe('HELOC');
    expect(debtGroupForSubtype('credit')).toBe('Credit cards');
    expect(debtGroupForSubtype('auto')).toBe('Auto loans');
    expect(debtGroupForSubtype('student')).toBe('Student loans');
  });

  it('folds the long tail into Other debt', () => {
    for (const s of ['personal', 'retirement_loan', 'policy_loan', 'medical', 'tax', 'other_debt']) {
      expect(debtGroupForSubtype(s)).toBe('Other debt');
    }
  });

  it('never drops a liability, whatever its subtype', () => {
    // Plaid accounts predate this catalog and carry subtypes it never issued.
    // A bucket of null would silently remove real debt from the waterfall.
    expect(debtGroupForSubtype('credit card')).toBe('Credit cards');
    expect(debtGroupForSubtype('home equity line of credit')).toBe('HELOC');
    expect(debtGroupForSubtype('')).toBe('Other debt');
    expect(debtGroupForSubtype('nonsense')).toBe('Other debt');
  });

  it('covers every debt entry the catalog defines', () => {
    // A new debt entry with no bucket would land in Other debt silently; this
    // fails loudly instead, so the mapping is reviewed alongside the catalog.
    for (const item of CATALOG.filter((c) => c.side === 'liability')) {
      expect(DEBT_GROUPS).toContain(debtGroupForSubtype(item.subtype));
    }
  });
});
