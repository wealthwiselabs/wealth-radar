import { describe, it, expect } from 'vitest';
import { netWorthSide } from '@/lib/netWorth/side';

describe('netWorthSide', () => {
  it('treats an explicit liability account as a liability', () => {
    expect(netWorthSide({ accountClass: 'liability', type: 'loan' })).toBe('liability');
  });

  // The load-bearing case: Plaid maps credit cards to accountClass 'spending'
  // because that classification drives the Home spending charts. This function
  // exists so mapAccount.ts never has to change.
  it('treats a Plaid credit card as a liability despite its spending class', () => {
    expect(netWorthSide({ accountClass: 'spending', type: 'credit' })).toBe('liability');
  });

  it('treats checking and savings as assets', () => {
    expect(netWorthSide({ accountClass: 'spending', type: 'depository' })).toBe('asset');
  });

  it('treats investment and asset classes as assets', () => {
    expect(netWorthSide({ accountClass: 'investment', type: 'investment' })).toBe('asset');
    expect(netWorthSide({ accountClass: 'asset', type: 'property' })).toBe('asset');
  });
});
