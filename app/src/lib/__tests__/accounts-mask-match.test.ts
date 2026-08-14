import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { resolveOrCreateAccount } from '@/lib/accounts';
import { accounts } from '@/db/schema';

const now = '2026-07-30T00:00:00.000Z';
function seed(db: any, id: string, owner: string, name: string, mask: string | null) {
  db.insert(accounts).values({
    id, name, institution: 'Chase', owner, mask, nameSource: 'derived',
    accountClass: 'spending', type: 'credit', origin: 'manual', status: 'active',
    createdAt: now, modifiedAt: now,
  }).run();
}

describe('resolveOrCreateAccount mask-aware matching', () => {
  it('routes a statement to the account with the matching mask', async () => {
    const { db } = makeTmpDb();
    seed(db, 'S', 'Alex', 'Sapphire', '3124');
    seed(db, 'X', 'Sam', 'Sapphire', '3121');
    const got = await resolveOrCreateAccount(
      { institution: 'Chase', name: 'Sapphire Preferred', mask: '3121' }, db);
    expect(got.id).toBe('X');
  });

  it('creates a new account when the mask matches nothing', async () => {
    const { db } = makeTmpDb();
    seed(db, 'S', 'Alex', 'Sapphire', '3124');
    const got = await resolveOrCreateAccount(
      { institution: 'Chase', name: 'Sapphire', mask: '3116', owner: 'Joint' }, db);
    expect(got.id).not.toBe('S');
    expect(got.mask).toBe('3116');
    expect(got.owner).toBe('Joint');
  });

  it('adopts and backfills a mask-less account when only one candidate exists', async () => {
    const { db } = makeTmpDb();
    seed(db, 'S', 'Alex', 'Sapphire', null);
    const got = await resolveOrCreateAccount(
      { institution: 'Chase', name: 'Sapphire', mask: '3124' }, db);
    expect(got.id).toBe('S');
    const row = db.select().from(accounts).all().find((r: any) => r.id === 'S')!;
    expect(row.mask).toBe('3124');
  });

  it('still matches on canonical key when no mask is available', async () => {
    const { db } = makeTmpDb();
    seed(db, 'S', 'Alex', 'Sapphire', '3124');
    const got = await resolveOrCreateAccount(
      { institution: 'JPMorgan Chase Bank, N.A.', name: 'Credit Card (Sapphire)' }, db);
    expect(got.id).toBe('S');
  });

  it('refuses to guess when a mask-less import has two same-label candidates', async () => {
    const { db } = makeTmpDb();
    seed(db, 'S', 'Alex', 'Sapphire', '3124');
    seed(db, 'X', 'Sam', 'Sapphire', '3121');
    await expect(
      resolveOrCreateAccount({ institution: 'Chase', name: 'Sapphire' }, db),
    ).rejects.toThrow(/ambiguous/i);
  });
});
