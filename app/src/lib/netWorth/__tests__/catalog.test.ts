import { describe, it, expect } from 'vitest';
import { CATALOG, catalogByKey, groupForSubtype, ASSET_GROUPS } from '@/lib/netWorth/catalog';

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
});
