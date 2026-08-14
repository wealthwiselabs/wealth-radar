import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { resolveOrCreateAccount, getAccountByPlaidId, listAccounts } from '@/lib/accounts';

describe('resolveOrCreateAccount by plaidAccountId', () => {
  it('matches an existing account by plaidAccountId even if the name changed', async () => {
    const { db } = makeTmpDb();
    const a = await resolveOrCreateAccount({ institution: 'Chase', name: 'Sapphire', plaidAccountId: 'p1', plaidItemId: 'it1' }, db);
    const b = await resolveOrCreateAccount({ institution: 'Chase', name: 'Sapphire Renamed', plaidAccountId: 'p1' }, db);
    expect(b.id).toBe(a.id);
    expect((await listAccounts(db))).toHaveLength(1);
    expect((await getAccountByPlaidId('p1', db))?.id).toBe(a.id);
  });
  it('persists plaidItemId on create', async () => {
    const { db } = makeTmpDb();
    const a = await resolveOrCreateAccount({ institution: 'Chase', name: 'Checking', plaidAccountId: 'p2', plaidItemId: 'it9' }, db);
    expect(a.plaidItemId).toBe('it9');
    expect(a.plaidAccountId).toBe('p2');
  });

  it('creates a DISTINCT account per plaidAccountId even when (institution, name) collide', async () => {
    const { db } = makeTmpDb();
    const first = await resolveOrCreateAccount({ institution: 'Bank', name: 'Checking', plaidAccountId: 'p1' }, db);
    const second = await resolveOrCreateAccount({ institution: 'Bank', name: 'Checking', plaidAccountId: 'p2' }, db);
    // Two separate rows — the second is NOT attached to the first's row.
    expect(second.id).not.toBe(first.id);
    expect(await listAccounts(db)).toHaveLength(2);
    // Each is resolvable by its own plaidAccountId.
    expect((await getAccountByPlaidId('p1', db))?.id).toBe(first.id);
    expect((await getAccountByPlaidId('p2', db))?.id).toBe(second.id);
  });
});
