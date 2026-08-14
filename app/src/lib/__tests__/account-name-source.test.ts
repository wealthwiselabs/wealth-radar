import { describe, it, expect } from 'vitest';
import { applyAccountPatch } from '@/lib/accountLifecycle';
import type { AccountRow } from '@/lib/accounts';

const base = {
  id: 'A', name: 'Card', institution: 'Chase', mask: '3119', owner: 'Alex',
  nameSource: 'derived', accountClass: 'spending', type: 'credit', subtype: null,
  origin: 'plaid', plaidItemId: null, plaidAccountId: 'pa-1',
  activeFromMonth: null, closedAtMonth: null, status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z', modifiedAt: '2026-07-01T00:00:00.000Z',
} as unknown as AccountRow;

describe('applyAccountPatch name_source', () => {
  it('marks the name as user-assigned on rename', () => {
    const p = applyAccountPatch(base, { name: 'Freedom' });
    expect(p.name).toBe('Freedom');
    expect(p.nameSource).toBe('user');
  });

  it('leaves name_source untouched when the patch does not rename', () => {
    const p = applyAccountPatch(base, { status: 'closed' });
    expect(p.nameSource).toBe('derived');
  });

  it('does not downgrade an already-user name', () => {
    const p = applyAccountPatch({ ...base, nameSource: 'user' } as AccountRow, { status: 'closed' });
    expect(p.nameSource).toBe('user');
  });

  it('applies an owner change', () => {
    const p = applyAccountPatch(base, { owner: 'Sam' });
    expect(p.owner).toBe('Sam');
  });

  it('keeps the existing owner when the patch omits it', () => {
    const p = applyAccountPatch(base, { name: 'Freedom' });
    expect(p.owner).toBe('Alex');
  });
});
