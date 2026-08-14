import { describe, it, expect } from 'vitest';
import { mapPlaidSecurity } from '@/lib/plaid/mapSecurity';

describe('mapPlaidSecurity', () => {
  it('maps an ETF with a ticker', () => {
    const s = mapPlaidSecurity({ ticker_symbol: 'VGT', name: 'Vanguard Information Technology ETF', type: 'etf' });
    expect(s).toMatchObject({ ticker: 'VGT', name: 'Vanguard Information Technology ETF', kind: 'etf', assetType: 'equity', tagSource: 'plaid' });
  });

  it('maps a mutual fund', () => {
    expect(mapPlaidSecurity({ ticker_symbol: 'VMFXX', name: 'Vanguard Federal Money Market', type: 'mutual fund' }))
      .toMatchObject({ kind: 'mutual_fund', assetType: 'money_market' });
  });

  it('maps equity, fixed income, and cash to asset types', () => {
    expect(mapPlaidSecurity({ ticker_symbol: 'AAPL', name: 'Apple', type: 'equity' }).assetType).toBe('equity');
    expect(mapPlaidSecurity({ ticker_symbol: null, name: 'US Treasury', type: 'fixed income' }).assetType).toBe('bond');
    expect(mapPlaidSecurity({ ticker_symbol: null, name: 'Cash', type: 'cash' }).assetType).toBe('cash');
  });

  it('normalizes an empty ticker to null and a missing name to a fallback', () => {
    const s = mapPlaidSecurity({ ticker_symbol: '', name: null, type: 'other' });
    expect(s.ticker).toBeNull();
    expect(s.name).toBe('Unknown security');
    expect(s.kind).toBe('other');
    expect(s.assetType).toBe('other');
  });
});
