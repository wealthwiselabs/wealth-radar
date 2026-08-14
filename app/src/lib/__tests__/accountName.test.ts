import { describe, it, expect } from 'vitest';
import { canonicalInstitution, canonicalLabel, canonicalAccount, accountMatchKey, proposeMerges } from '@/lib/accountName';

describe('canonical account naming', () => {
  it('canonicalizes institutions', () => {
    expect(canonicalInstitution('JPMorgan Chase Bank, N.A.')).toBe('Chase');
    expect(canonicalInstitution('American Express')).toBe('Amex');
    expect(canonicalInstitution('Citibank')).toBe('Citi');
  });
  it('folds the U.S. Bancorp brokerage arms into US Bank', () => {
    // Brokerage statements are branded "U.S. Bancorp Advisors/Investments", never
    // "U.S. Bank" — without this the statement importer cannot match the Plaid account.
    expect(canonicalInstitution('U.S. BANCORP ADVISORS, LLC')).toBe('US Bank');
    expect(canonicalInstitution('U.S. Bancorp Investments')).toBe('US Bank');
    expect(canonicalInstitution('US Bancorp')).toBe('US Bank');
    expect(canonicalInstitution('U.S. Bank')).toBe('US Bank');
  });
  it('derives short card/product labels', () => {
    expect(canonicalLabel('Credit Card (Sapphire Preferred)')).toBe('Sapphire');
    expect(canonicalLabel('Credit Card - Freedom Unlimited')).toBe('Freedom Unlimited');
    expect(canonicalLabel('Green Card (Credit Card)')).toBe('Green');
    expect(canonicalLabel('Delta SkyMiles® Platinum Credit Card')).toBe('Delta'); // co-brand wins over "platinum"
    expect(canonicalLabel('Platinum Card (Credit Card)')).toBe('Platinum');
  });
  it('derives depository + loan labels', () => {
    expect(canonicalLabel('Checking & Savings', { type: 'depository', subtype: 'checking' })).toBe('Checking');
    expect(canonicalLabel('Chase Total Checking')).toBe('Checking');
    expect(canonicalLabel('Home Mortgage', { type: 'loan', subtype: 'mortgage' })).toBe('Mortgage');
  });
  it('is type-aware: a card-tier word in a depository/loan/investment name does not win', () => {
    // Plaid type is authoritative — "Green"/"Gold" here are marketing words, not card products.
    expect(canonicalLabel('TD Green Rewards Checking', { type: 'depository', subtype: 'checking' })).toBe('Checking');
    expect(canonicalLabel('Gold Star Savings', { type: 'depository', subtype: 'savings' })).toBe('Saving');
    expect(canonicalLabel('Plaid 401k', { type: 'investment', subtype: '401k' })).toBe('401k');
    expect(canonicalLabel('Roth Contributory IRA', { type: 'investment', subtype: 'roth' })).toBe('Roth IRA');
    expect(canonicalLabel('Home Mortgage', { type: 'loan', subtype: 'mortgage' })).toBe('Mortgage');
  });
  it('keeps products-first when no type is given (PDF accounts) — regression guard', () => {
    expect(canonicalLabel('Green Card (Credit Card)')).toBe('Green');
    expect(canonicalLabel('Delta SkyMiles® Platinum Credit Card')).toBe('Delta');
  });
  it('canonicalAccount produces the {institution,name} pair', () => {
    expect(canonicalAccount('JPMorgan Chase Bank, N.A.', 'Credit Card - Freedom Unlimited'))
      .toEqual({ institution: 'Chase', name: 'Freedom Unlimited' });
  });
  it('proposeMerges groups variants by canonical key, busiest as target, carries canonical name', () => {
    const proposals = proposeMerges([
      { id:'a', institution:'Amex', name:'Green Card (Credit Card)', txnCount:69 },
      { id:'b', institution:'American Express', name:'Green Card Credit Card', txnCount:27 },
      { id:'c', institution:'Amex', name:'Platinum Card', txnCount:5 },
    ]);
    const green = proposals.find(p => p.canonical.name === 'Green');
    expect(green?.targetId).toBe('a');           // busiest
    expect(green?.sourceIds).toEqual(['b']);
    expect(green?.canonical).toEqual({ institution: 'Amex', name: 'Green' });
    expect(proposals.some(p => p.canonical.name === 'Platinum')).toBe(false); // singleton not proposed
  });
});

describe('digits-only labels', () => {
  it('falls back to the generic label when the bank reports a bare card number', () => {
    expect(canonicalLabel('3117', { type: 'credit', subtype: 'credit card' })).toBe('Card');
    expect(canonicalLabel('  3110  ')).toBe('Card');
  });

  it('still keeps an alphanumeric product name', () => {
    expect(canonicalLabel('Cash Plus 3117', { type: 'credit' })).toBe('Cash Plus 3117');
  });
});
