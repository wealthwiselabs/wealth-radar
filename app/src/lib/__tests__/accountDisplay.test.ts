import { describe, it, expect } from 'vitest';
import { accountBaseName, accountDisplayName, transactionAccountLabel } from '@/lib/accountDisplay';

const a = (owner: string, name: string, mask: string | null = null) =>
  ({ owner, institution: 'Chase', name, mask });

describe('accountDisplayName', () => {
  it('joins owner, institution and label', () => {
    expect(accountBaseName(a('Alex', 'Sapphire'))).toBe('Alex Chase Sapphire');
  });

  it('omits an empty owner without leaving a leading space', () => {
    expect(accountBaseName(a('', 'Sapphire'))).toBe('Chase Sapphire');
  });

  it('adds no mask suffix when the base name is unique', () => {
    const list = [a('Alex', 'Sapphire', '3124'), a('Sam', 'Sapphire', '3121')];
    expect(accountDisplayName(list[0], list)).toBe('Alex Chase Sapphire');
  });

  it('adds a mask suffix when two accounts share a base name', () => {
    const list = [a('Alex', 'Freedom', '3128'), a('Alex', 'Freedom', '3119')];
    expect(accountDisplayName(list[0], list)).toBe('Alex Chase Freedom · 3128');
    expect(accountDisplayName(list[1], list)).toBe('Alex Chase Freedom · 3119');
  });

  it('falls back to the base name when a colliding account has no mask', () => {
    const list = [a('Alex', 'Freedom', null), a('Alex', 'Freedom', '3119')];
    expect(accountDisplayName(list[0], list)).toBe('Alex Chase Freedom');
  });

  it('returns the base name when no account list is supplied', () => {
    expect(accountDisplayName(a('Alex', 'Freedom', '3128'))).toBe('Alex Chase Freedom');
  });
});

describe('transactionAccountLabel', () => {
  it('renders owner, bank and account delimited', () => {
    expect(transactionAccountLabel({ owner: 'Alex', bank: 'Chase', account: 'Freedom' }))
      .toBe('Alex · Chase · Freedom');
  });

  it('omits an unassigned owner without a dangling separator', () => {
    expect(transactionAccountLabel({ owner: '', bank: 'Citi', account: 'Checking' }))
      .toBe('Citi · Checking');
  });

  it('tolerates a missing owner field on legacy rows', () => {
    expect(transactionAccountLabel({ bank: 'Amex', account: 'Green' }))
      .toBe('Amex · Green');
  });
});
