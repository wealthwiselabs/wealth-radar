import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { resolveOrCreateAccount, listAccounts } from '@/lib/accounts';

describe('resolveOrCreateAccount canonicalizes names', () => {
  it('collapses name variants into one canonically-named account', async () => {
    const { db } = makeTmpDb();
    const a = await resolveOrCreateAccount({ institution:'JPMorgan Chase Bank, N.A.', name:'Credit Card - Freedom Unlimited' }, db);
    const b = await resolveOrCreateAccount({ institution:'Chase', name:'Credit Card (Freedom Unlimited)' }, db);
    expect(b.id).toBe(a.id);
    expect(await listAccounts(db)).toHaveLength(1);
    expect(a.institution).toBe('Chase');       // stored canonical
    expect(a.name).toBe('Freedom Unlimited');
  });
  it('keeps genuinely different cards separate', async () => {
    const { db } = makeTmpDb();
    await resolveOrCreateAccount({ institution:'Amex', name:'Green Card' }, db);
    await resolveOrCreateAccount({ institution:'Amex', name:'Platinum Card' }, db);
    expect(await listAccounts(db)).toHaveLength(2);
  });
});
