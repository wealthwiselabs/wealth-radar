import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { autoMergePlaidIntoHistory } from '@/lib/accountAutoMerge';
import { accounts, transactions } from '@/db/schema';
import { transactionFingerprint } from '@/lib/fingerprint';

const now = '2026-07-30T00:00:00.000Z';
const ITEM = 'item-1';

function pdf(db: any, o: any) {
  db.insert(accounts).values({
    id: o.id, name: o.name, institution: o.inst, owner: o.owner, mask: o.mask ?? null,
    accountClass: 'spending', type: 'unknown', origin: 'manual', status: 'active',
    nameSource: 'derived', createdAt: now, modifiedAt: now,
  }).run();
}
function plaid(db: any, o: any) {
  db.insert(accounts).values({
    id: o.id, name: o.name, institution: o.inst, owner: o.owner, mask: o.mask ?? null,
    accountClass: 'spending', type: 'depository', origin: 'plaid',
    plaidItemId: o.item ?? ITEM, plaidAccountId: `pa-${o.id}`, status: 'active',
    nameSource: 'derived', createdAt: now, modifiedAt: now,
  }).run();
}
function tx(db: any, id: string, accountId: string, date: string) {
  db.insert(transactions).values({
    id, accountId, date, month: date.slice(0, 7), description: 'X', amount: -1,
    categoryId: '', subcategoryId: '', note: '', source: 'pdf',
    fingerprint: transactionFingerprint({ accountId, date, description: 'X', amount: -1 }),
    pending: false, createdAt: now, modifiedAt: now,
  }).run();
}
const ids = (db: any) => db.select().from(accounts).all().map((a: any) => a.id).sort();

describe('autoMergePlaidIntoHistory', () => {
  it('merges a new plaid account into the PDF account it continues', () => {
    const { db } = makeTmpDb();
    pdf(db, { id: 'P', name: 'Checking', inst: 'Citi', owner: 'Alex' });
    tx(db, 't1', 'P', '2026-04-24');
    plaid(db, { id: 'L', name: 'Checking', inst: 'Citi', owner: 'Alex', mask: '3122' });

    const merged = autoMergePlaidIntoHistory(ITEM, db);

    expect(merged).toHaveLength(1);
    expect(ids(db)).toEqual(['P']);                    // PDF row survives
    const row = db.select().from(accounts).all()[0];
    expect(row.plaidAccountId).toBe('pa-L');           // absorbs the plaid link
    expect(row.mask).toBe('3122');
  });

  it('does not merge when the masks are different cards', () => {
    const { db } = makeTmpDb();
    pdf(db, { id: 'P', name: 'Checking', inst: 'Chase', owner: 'Alex', mask: '3125' });
    plaid(db, { id: 'L', name: 'Checking', inst: 'Chase', owner: 'Alex', mask: '3109' });

    expect(autoMergePlaidIntoHistory(ITEM, db)).toHaveLength(0);
    expect(ids(db)).toEqual(['L', 'P']);
  });

  it('does not merge across owners', () => {
    const { db } = makeTmpDb();
    pdf(db, { id: 'P', name: 'Sapphire', inst: 'Chase', owner: 'Sam' });
    plaid(db, { id: 'L', name: 'Sapphire', inst: 'Chase', owner: 'Alex', mask: '3124' });

    expect(autoMergePlaidIntoHistory(ITEM, db)).toHaveLength(0);
    expect(ids(db)).toEqual(['L', 'P']);
  });

  it('does not merge when the candidate owner is unassigned', () => {
    const { db } = makeTmpDb();
    pdf(db, { id: 'P', name: 'Checking', inst: 'Citi', owner: '' });
    plaid(db, { id: 'L', name: 'Checking', inst: 'Citi', owner: 'Alex', mask: '3122' });

    expect(autoMergePlaidIntoHistory(ITEM, db)).toHaveLength(0);
  });

  it('excludes a mask-mismatched PDF row, leaving one valid candidate', () => {
    const { db } = makeTmpDb();
    pdf(db, { id: 'P1', name: 'Checking', inst: 'Citi', owner: 'Alex' });
    pdf(db, { id: 'P2', name: 'Checking', inst: 'Citi', owner: 'Alex', mask: '3100' });
    plaid(db, { id: 'L', name: 'Checking', inst: 'Citi', owner: 'Alex', mask: '3122' });

    // P2's mask (3100) rules it out, so P1 is the only candidate and the merge
    // proceeds. Without the mask rule this would be ambiguous and unsafe.
    const merged = autoMergePlaidIntoHistory(ITEM, db);
    expect(merged).toHaveLength(1);
    expect(ids(db)).toEqual(['P1', 'P2']);
  });

  it('does not merge when two plaid accounts claim the same PDF row', () => {
    const { db } = makeTmpDb();
    pdf(db, { id: 'P', name: 'Checking', inst: 'Citi', owner: 'Alex' });
    plaid(db, { id: 'L1', name: 'Checking', inst: 'Citi', owner: 'Alex', mask: '3122' });
    plaid(db, { id: 'L2', name: 'Checking', inst: 'Citi', owner: 'Alex', mask: '3123' });

    expect(autoMergePlaidIntoHistory(ITEM, db)).toHaveLength(0);
    expect(ids(db)).toEqual(['L1', 'L2', 'P']);
  });

  it('merges an already-synced plaid account when the histories are continuous', () => {
    const { db } = makeTmpDb();
    pdf(db, { id: 'P', name: 'Checking', inst: 'Citi', owner: 'Alex' });
    tx(db, 'h1', 'P', '2026-04-24');
    plaid(db, { id: 'L', name: 'Checking', inst: 'Citi', owner: 'Alex', mask: '3122' });
    tx(db, 'f1', 'L', '2026-05-04');   // statement history ends, feed picks up

    expect(autoMergePlaidIntoHistory(ITEM, db)).toHaveLength(1);
    expect(ids(db)).toEqual(['P']);
    expect(db.select().from(transactions).all()).toHaveLength(2);
  });

  it('does not merge when both accounts transacted on the same day', () => {
    const { db } = makeTmpDb();
    // Overlapping activity means two accounts running in parallel, not one
    // account's history followed by its feed.
    pdf(db, { id: 'P', name: 'Checking', inst: 'Citi', owner: 'Alex' });
    tx(db, 'h1', 'P', '2026-05-04');
    plaid(db, { id: 'L', name: 'Checking', inst: 'Citi', owner: 'Alex', mask: '3122' });
    tx(db, 'f1', 'L', '2026-05-04');

    expect(autoMergePlaidIntoHistory(ITEM, db)).toHaveLength(0);
    expect(ids(db)).toEqual(['L', 'P']);
  });

  it('never merges into another live plaid account', () => {
    const { db } = makeTmpDb();
    // A is mask-less and on a different Item, so it matches every rule EXCEPT
    // being a PDF row — it must still be rejected as a candidate.
    plaid(db, { id: 'A', name: 'Checking', inst: 'Citi', owner: 'Alex', mask: null, item: 'other' });
    plaid(db, { id: 'L', name: 'Checking', inst: 'Citi', owner: 'Alex', mask: '3122' });

    expect(autoMergePlaidIntoHistory(ITEM, db)).toHaveLength(0);
    expect(ids(db)).toEqual(['A', 'L']);
  });

  it('leaves a genuinely new account alone', () => {
    const { db } = makeTmpDb();
    plaid(db, { id: 'L', name: 'Saving', inst: 'Citi', owner: 'Alex', mask: '3123' });
    expect(autoMergePlaidIntoHistory(ITEM, db)).toHaveLength(0);
    expect(ids(db)).toEqual(['L']);
  });

  it('merges on an identical mask even when the names differ', () => {
    const { db } = makeTmpDb();
    pdf(db, { id: 'P', name: 'Southwest', inst: 'Chase', owner: 'Sam', mask: '3104' });
    tx(db, 't1', 'P', '2026-02-10');
    plaid(db, { id: 'L', name: 'Southwest Rapid Rewards', inst: 'Chase', owner: 'Sam', mask: '3104' });

    const done = autoMergePlaidIntoHistory(ITEM, db);
    expect(done).toHaveLength(1);
    expect(ids(db)).toEqual(['P']);
  });

  it('refuses to merge differing masks even when the names match', () => {
    const { db } = makeTmpDb();
    pdf(db, { id: 'P', name: 'Southwest', inst: 'Chase', owner: 'Sam', mask: '3104' });
    plaid(db, { id: 'L', name: 'Southwest', inst: 'Chase', owner: 'Sam', mask: '3114' });

    expect(autoMergePlaidIntoHistory(ITEM, db)).toHaveLength(0);
    expect(ids(db)).toEqual(['L', 'P']);
  });

  it('refuses a mask-less candidate whose name differs', () => {
    const { db } = makeTmpDb();
    pdf(db, { id: 'P', name: 'Southwest', inst: 'Chase', owner: 'Sam' });
    plaid(db, { id: 'L', name: 'Southwest Rapid Rewards', inst: 'Chase', owner: 'Sam', mask: '3104' });

    expect(autoMergePlaidIntoHistory(ITEM, db)).toHaveLength(0);
    expect(ids(db)).toEqual(['L', 'P']);
  });

  it('still refuses when the mask matches but an owner is unassigned', () => {
    const { db } = makeTmpDb();
    pdf(db, { id: 'P', name: 'Southwest', inst: 'Chase', owner: '', mask: '3104' });
    plaid(db, { id: 'L', name: 'Southwest Rapid Rewards', inst: 'Chase', owner: 'Sam', mask: '3104' });

    expect(autoMergePlaidIntoHistory(ITEM, db)).toHaveLength(0);
    expect(ids(db)).toEqual(['L', 'P']);
  });

  it('still refuses when the mask matches but two candidates compete', () => {
    const { db } = makeTmpDb();
    pdf(db, { id: 'P1', name: 'Southwest', inst: 'Chase', owner: 'Sam', mask: '3104' });
    pdf(db, { id: 'P2', name: 'Southwest Card', inst: 'Chase', owner: 'Sam', mask: '3104' });
    plaid(db, { id: 'L', name: 'Southwest Rapid Rewards', inst: 'Chase', owner: 'Sam', mask: '3104' });

    expect(autoMergePlaidIntoHistory(ITEM, db)).toHaveLength(0);
    expect(ids(db)).toEqual(['L', 'P1', 'P2']);
  });
});
