import { describe, it, expect } from 'vitest';
import { mapPlaidAccount } from '@/lib/plaid/mapAccount';

describe('mapPlaidAccount', () => {
  it('maps a credit card to spending', () => {
    const r = mapPlaidAccount(
      { account_id: 'p1', name: 'Sapphire', official_name: null, mask: '3118',
        type: 'credit', subtype: 'credit card', balances: {} } as any,
      'Chase');
    expect(r).toMatchObject({
      institution: 'Chase', name: 'Sapphire', mask: '3118',
      accountClass: 'spending', type: 'credit', subtype: 'credit card',
      origin: 'plaid', plaidAccountId: 'p1',
    });
  });
  it('maps an investment/brokerage to investment class', () => {
    const r = mapPlaidAccount(
      { account_id: 'p2', name: 'Brokerage', official_name: null, mask: '3100',
        type: 'investment', subtype: 'brokerage', balances: {} } as any,
      'Vanguard');
    expect(r.accountClass).toBe('investment');
  });
  it('maps a loan/mortgage to liability', () => {
    const r = mapPlaidAccount(
      { account_id: 'p3', name: 'Home Mortgage', official_name: null, mask: '3129',
        type: 'loan', subtype: 'mortgage', balances: {} } as any,
      'Citi');
    expect(r.accountClass).toBe('liability');
    expect(r.type).toBe('loan');
  });
  it('maps a student loan to liability', () => {
    const r = mapPlaidAccount({ account_id: 'p4', name: 'Student Loan', official_name: null, mask: '3127', type: 'loan', subtype: 'student', balances: {} } as any, 'Citi');
    expect(r.accountClass).toBe('liability');
  });
});
