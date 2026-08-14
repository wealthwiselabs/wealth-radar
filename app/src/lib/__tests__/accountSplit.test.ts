import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { splitAccount } from '@/lib/accountSplit';
import { accounts, transactions, statementImports, monthlyAggregates } from '@/db/schema';
import { transactionFingerprint } from '@/lib/fingerprint';
import { eq } from 'drizzle-orm';

const now = '2026-07-30T00:00:00.000Z';
function seed(db: any) {
  db.insert(accounts).values({
    id: 'SRC', name: 'Sapphire', institution: 'Chase', owner: 'Alex', mask: null,
    accountClass: 'spending', type: 'credit', origin: 'manual', status: 'active',
    createdAt: now, modifiedAt: now,
  }).run();
  const tx = (id: string, date: string, desc: string, amount: number, file: string) =>
    db.insert(transactions).values({
      id, accountId: 'SRC', date, month: date.slice(0, 7), description: desc, amount,
      categoryId: 'food', subcategoryId: 'x', note: '', source: 'pdf', sourceFile: file,
      fingerprint: transactionFingerprint({ accountId: 'SRC', date, description: desc, amount }),
      pending: false, createdAt: now, modifiedAt: now,
    }).run();
  tx('m1', '2026-01-10', 'STARBUCKS', -5, '20260121-statements-3124-.pdf');
  tx('m2', '2026-02-10', 'UBER', -8, '20260221-statements-3124-.pdf');
  tx('x1', '2026-01-15', 'TARGET', -20, '20260126-statements-3121-sam.pdf');
  db.insert(statementImports).values({ id: 's1', accountId: 'SRC', month: '2026-01', sourceFile: '20260126-statements-3121-sam.pdf', importedAt: now }).run();
  db.insert(statementImports).values({ id: 's2', accountId: 'SRC', month: '2026-02', sourceFile: '20260221-statements-3124-.pdf', importedAt: now }).run();
}

describe('splitAccount', () => {
  it('moves matching transactions to a new account and recomputes both sides', () => {
    const { db } = makeTmpDb();
    seed(db);
    const res = splitAccount('SRC', {
      match: (t) => (t.sourceFile ?? '').includes('3121'),
      into: { owner: 'Sam', mask: '3121' },
    }, db);

    expect(res.moved).toBe(1);
    expect(res.statementsMoved).toBe(1);

    const moved = db.select().from(transactions).where(eq(transactions.id, 'x1')).get()!;
    expect(moved.accountId).toBe(res.newAccountId);
    expect(moved.fingerprint).toBe(transactionFingerprint({
      accountId: res.newAccountId, date: '2026-01-15', description: 'TARGET', amount: -20,
    }));

    const kept = db.select().from(transactions).where(eq(transactions.accountId, 'SRC')).all();
    expect(kept).toHaveLength(2);

    const newAcct = db.select().from(accounts).where(eq(accounts.id, res.newAccountId)).get()!;
    expect(newAcct.owner).toBe('Sam');
    expect(newAcct.mask).toBe('3121');
    expect(newAcct.name).toBe('Sapphire');       // inherits the label by default
    expect(newAcct.institution).toBe('Chase');

    const stmt = db.select().from(statementImports).where(eq(statementImports.id, 's1')).get()!;
    expect(stmt.accountId).toBe(res.newAccountId);

    const aggs = db.select().from(monthlyAggregates).all();
    expect(aggs.some((a: any) => a.accountId === res.newAccountId)).toBe(true);
    expect(aggs.some((a: any) => a.accountId === 'SRC')).toBe(true);
  });

  it('refuses a predicate that matches every transaction', () => {
    const { db } = makeTmpDb();
    seed(db);
    expect(() => splitAccount('SRC', { match: () => true, into: { owner: 'Sam' } }, db))
      .toThrow(/all|every/i);
  });

  it('refuses a predicate that matches nothing', () => {
    const { db } = makeTmpDb();
    seed(db);
    expect(() => splitAccount('SRC', { match: () => false, into: { owner: 'Sam' } }, db))
      .toThrow(/no transactions/i);
  });
});
