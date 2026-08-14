import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { resolveOrCreateAccount, listAccounts } from '@/lib/accounts';

describe('resolveOrCreateAccount', () => {
  it('creates once and reuses on same (institution,name)', async () => {
    const { db } = makeTmpDb();
    const a = await resolveOrCreateAccount({ institution: 'Chase', name: 'Credit Card' }, db);
    const b = await resolveOrCreateAccount({ institution: 'Chase', name: 'Credit Card' }, db);
    expect(a.id).toBe(b.id);
    expect((await listAccounts(db))).toHaveLength(1);
  });

  it('creates distinct accounts for different names', async () => {
    const { db } = makeTmpDb();
    await resolveOrCreateAccount({ institution: 'Chase', name: 'Credit Card' }, db);
    await resolveOrCreateAccount({ institution: 'Chase', name: 'Checking' }, db);
    expect((await listAccounts(db))).toHaveLength(2);
  });

  it('defaults accountClass to spending', async () => {
    const { db } = makeTmpDb();
    const a = await resolveOrCreateAccount({ institution: 'Amex', name: 'Credit Card' }, db);
    expect(a.accountClass).toBe('spending');
  });
});
