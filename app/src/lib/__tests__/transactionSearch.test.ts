import { describe, it, expect } from 'vitest';
import { searchTransactions } from '@/lib/transactionSearch';

interface Row {
  id: string;
  description: string;
  note: string;
  bank: string;
  account: string;
  owner: string;
  categoryId: string;
  subcategoryId: string;
}

const CATEGORY_NAMES: Record<string, string> = {
  food: 'Food & Dining',
  shopping: 'Shopping',
};
const SUBCATEGORY_NAMES: Record<string, string> = {
  coffee: 'Coffee Shops',
  streaming: 'Streaming Services',
};

const rows: Row[] = [
  {
    id: 'a',
    description: 'STARBUCKS STORE #1234',
    note: '',
    bank: 'Chase',
    account: 'Sapphire',
    owner: 'Alex',
    categoryId: 'food',
    subcategoryId: 'coffee',
  },
  {
    id: 'b',
    description: 'AMAZON MARKETPLACE',
    note: 'birthday gift',
    bank: 'Amex',
    account: 'Gold',
    owner: 'Sam',
    categoryId: 'shopping',
    subcategoryId: '',
  },
  {
    id: 'c',
    description: 'NETFLIX.COM',
    note: '',
    bank: 'Chase',
    account: 'Freedom',
    owner: 'Alex',
    categoryId: 'shopping',
    subcategoryId: 'streaming',
  },
];

const labels = {
  category: (t: Row) => CATEGORY_NAMES[t.categoryId] ?? '',
  subcategory: (t: Row) => SUBCATEGORY_NAMES[t.subcategoryId] ?? '',
};

const search = (q: string) =>
  searchTransactions(rows, q, labels).map((r) => r.id);

describe('searchTransactions', () => {
  it('returns all rows for an empty or whitespace query', () => {
    expect(search('')).toEqual(['a', 'b', 'c']);
    expect(search('   ')).toEqual(['a', 'b', 'c']);
  });

  it('preserves input order of matching rows', () => {
    // Both 'a' and 'c' are Chase; order must follow the input, not match order.
    expect(search('chase')).toEqual(['a', 'c']);
  });

  it('matches on description, case-insensitively', () => {
    expect(search('starbucks')).toEqual(['a']);
    expect(search('AMAZON')).toEqual(['b']);
  });

  it('matches a substring / partial word', () => {
    expect(search('market')).toEqual(['b']);
    expect(search('netfl')).toEqual(['c']);
  });

  it('matches on the note field', () => {
    expect(search('birthday')).toEqual(['b']);
  });

  it('matches on bank, account, and owner', () => {
    expect(search('sapphire')).toEqual(['a']);
    expect(search('amex')).toEqual(['b']);
    expect(search('sam')).toEqual(['b']);
  });

  it('matches on category and subcategory display names', () => {
    expect(search('dining')).toEqual(['a']);
    expect(search('streaming')).toEqual(['c']);
  });

  it('tolerates typos (fuzzy / blur match)', () => {
    expect(search('starbcks')).toEqual(['a']); // deletion
    expect(search('amazn')).toEqual(['b']); // deletion
    expect(search('netflx')).toEqual(['c']); // deletion
    expect(search('starbukcs')).toEqual(['a']); // transposition-ish
  });

  it('requires every token to match (AND semantics)', () => {
    expect(search('amazon gift')).toEqual(['b']);
    expect(search('amazon coffee')).toEqual([]);
  });

  it('does not fuzzy-match very short tokens, to avoid noise', () => {
    // 'ax' is within edit distance 1 of many words but is too short to fuzzy-match;
    // it should only match as a substring (which none of these rows contain as such).
    expect(search('ax')).toEqual([]);
  });

  it('returns nothing when there is no plausible match', () => {
    expect(search('zzzzz')).toEqual([]);
  });
});
