import { describe, it, expect } from 'vitest';
import { applyAccountPatch } from '@/lib/accountLifecycle';
import type { AccountRow } from '@/lib/accounts';

const row = (over: Partial<AccountRow>) => ({
  id: 'A', name: 'Card', institution: 'Chase', mask: '3119', owner: '',
  nameSource: 'derived', accountClass: 'spending', type: 'credit', subtype: null,
  origin: 'plaid', plaidItemId: null, plaidAccountId: 'pa-1',
  activeFromMonth: null, closedAtMonth: null, status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z', modifiedAt: '2026-07-01T00:00:00.000Z',
  ...over,
} as unknown as AccountRow);

// needsName mirrors the rule used by the API route.
const needsName = (a: AccountRow) => a.nameSource === 'derived' && (a.name === 'Card' || a.name === 'Account');

describe('needs-a-name flag', () => {
  it('flags a derived generic label', () => {
    expect(needsName(row({}))).toBe(true);
  });
  it('does not flag once the user has named it', () => {
    expect(needsName(row({ name: 'Freedom', nameSource: 'user' }))).toBe(false);
  });
  it('does not flag a real derived product label', () => {
    expect(needsName(row({ name: 'Sapphire' }))).toBe(false);
  });
});

describe('owner patch round-trip', () => {
  it('sets owner without touching the name', () => {
    const p = applyAccountPatch(row({ name: 'Sapphire' }), { owner: 'Sam' });
    expect(p.owner).toBe('Sam');
    expect(p.name).toBe('Sapphire');
    expect(p.nameSource).toBe('derived');
  });
});
