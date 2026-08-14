import { describe, it, expect } from 'vitest';
import { mapPlaidAccount } from '@/lib/plaid/mapAccount';

const plaid = (name: string, type: string, subtype: string, mask: string) => ({
  account_id: `pa-${mask}`, name, official_name: null, mask,
  type, subtype, balances: {} as any,
}) as any;

describe('mapPlaidAccount', () => {
  it('canonicalizes a depository name', () => {
    const r = mapPlaidAccount(plaid('TOTAL CHECKING', 'depository', 'checking', '3125'), 'Chase');
    expect(r.name).toBe('Checking');
    expect(r.institution).toBe('Chase');
  });

  it('canonicalizes a savings name', () => {
    const r = mapPlaidAccount(plaid('CHASE SAVINGS', 'depository', 'savings', '3101'), 'Chase');
    expect(r.name).toBe('Saving');
  });

  it('leaves an underivable credit card as the generic label', () => {
    const r = mapPlaidAccount(plaid('CREDIT CARD', 'credit', 'credit card', '3119'), 'Chase');
    expect(r.name).toBe('Card');
    expect(r.mask).toBe('3119');
  });

  it('still recognises a product when Plaid names one', () => {
    const r = mapPlaidAccount(plaid('CHASE FREEDOM UNLIMITED', 'credit', 'credit card', '3128'), 'Chase');
    expect(r.name).toBe('Freedom Unlimited');
  });

  it('propagates the owner from the Plaid item', () => {
    const r = mapPlaidAccount(plaid('CREDIT CARD', 'credit', 'credit card', '3103'), 'Chase', 'Sam');
    expect(r.owner).toBe('Sam');
  });

  it('defaults owner to empty when the item has none', () => {
    const r = mapPlaidAccount(plaid('CREDIT CARD', 'credit', 'credit card', '3113'), 'Chase');
    expect(r.owner).toBe('');
  });
});
