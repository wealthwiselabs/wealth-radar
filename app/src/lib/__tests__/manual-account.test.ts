import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { createManualAccount, AccountExistsError, listAccounts } from '@/lib/accounts';

describe('createManualAccount', () => {
  it('creates an investment account with the chosen purpose', async () => {
    const { db } = makeTmpDb();
    const a = await createManualAccount(
      { institution: 'Fidelity', name: '401k', owner: 'Alex', purpose: 'portfolio' }, db);
    expect(a.accountClass).toBe('investment');
    expect(a.origin).toBe('manual');
    expect(a.type).toBe('unknown');
    expect(a.mask).toBeNull();
    expect(a.purpose).toBe('portfolio');
    expect(a.owner).toBe('Alex');
    expect((await listAccounts(db))).toHaveLength(1);
  });

  it('defaults owner to empty and purpose to portfolio', async () => {
    const { db } = makeTmpDb();
    const a = await createManualAccount({ institution: 'Penn Mutual', name: 'IUL' }, db);
    expect(a.owner).toBe('');
    expect(a.purpose).toBe('portfolio');
  });

  it('rejects a duplicate (same owner, institution, name) with AccountExistsError', async () => {
    const { db } = makeTmpDb();
    await createManualAccount({ institution: 'Fidelity', name: '401k', owner: 'Alex' }, db);
    await expect(
      createManualAccount({ institution: 'Fidelity', name: '401k', owner: 'Alex' }, db),
    ).rejects.toBeInstanceOf(AccountExistsError);
    expect((await listAccounts(db))).toHaveLength(1);
  });

  it('allows the same institution/name under a different owner', async () => {
    const { db } = makeTmpDb();
    await createManualAccount({ institution: 'Fidelity', name: '401k', owner: 'Alex' }, db);
    const b = await createManualAccount({ institution: 'Fidelity', name: '401k', owner: 'Sam' }, db);
    expect(b.owner).toBe('Sam');
    expect((await listAccounts(db))).toHaveLength(2);
  });

  // Canonicalization must use the investment label table (type: 'investment'),
  // not the generic/card table — otherwise hand-typed investment product names
  // like "IRA" or "529" get mangled into "Ira" or "Card".
  it('canonicalizes "IRA" using the investment label table, not title-casing it', async () => {
    const { db } = makeTmpDb();
    const a = await createManualAccount({ institution: 'Fidelity', name: 'IRA', owner: 'Alex' }, db);
    expect(a.name).toBe('IRA');
  });

  it('canonicalizes "529" using the investment label table, not falling back to "Card"', async () => {
    const { db } = makeTmpDb();
    const a = await createManualAccount({ institution: 'Vanguard', name: '529', owner: 'Alex' }, db);
    expect(a.name).toBe('529');
  });
});
