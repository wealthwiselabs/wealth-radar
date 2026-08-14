// app/src/lib/__tests__/accountRemoval.test.ts
import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';
import { deleteAccountData } from '@/lib/accountRemoval';

const NOW = '2026-08-08T00:00:00.000Z';
function seedAccount(db: ReturnType<typeof makeTmpDb>['db'], id: string) {
  db.insert(schema.accounts).values({
    id, name: id, institution: 'US Bank', accountClass: 'investment', type: 'investment',
    origin: 'plaid', status: 'active', purpose: 'portfolio', owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
  db.insert(schema.securities).values({ id: id+'-sec', ticker: id.toUpperCase(), name: id, kind: 'stock', assetType: 'equity', createdAt: NOW, modifiedAt: NOW }).run();
  db.insert(schema.cashFlows).values({ id: id+'-f', accountId: id, securityId: null, date: '2026-01-01', amount: 1, kind: 'contribution', source: 'statement', confirmed: true, note: '', createdAt: NOW, modifiedAt: NOW }).run();
  db.insert(schema.investmentTransactions).values({ id: id+'-t', accountId: id, plaidInvestmentTxnId: id+'-pt', securityId: null, date: '2026-01-01', name: 'x', amount: 1, quantity: null, price: null, fees: null, type: 'buy', subtype: null, createdAt: NOW, modifiedAt: NOW }).run();
  db.insert(schema.investmentSnapshots).values({ id: id+'-s', accountId: id, asOf: '2026-01-31', month: '2026-01', source: 'statement', totalValue: 1, note: '', createdAt: NOW, modifiedAt: NOW }).run();
  db.insert(schema.snapshotHoldings).values({ id: id+'-h', snapshotId: id+'-s', securityId: id+'-sec', quantity: null, value: 1 }).run();
  db.insert(schema.transactions).values({
    id: id+'-tx', accountId: id, date: '2026-01-01', month: '2026-01', description: 'x', amount: 1,
    categoryId: '', subcategoryId: '', categorySource: 'ai', note: '', source: 'pdf', fingerprint: id+'-fp',
    pending: false, createdAt: NOW, modifiedAt: NOW,
  }).run();
  db.insert(schema.monthlyAggregates).values({
    id: id+'-agg', accountId: id, month: '2026-01', categoryId: null, expenseTotal: 1, incomeTotal: 0,
    net: 1, txnCount: 1, derivedFromTxns: true, source: 'pdf', updatedAt: NOW,
  }).run();
  db.insert(schema.statementImports).values({
    id: id+'-si', accountId: id, month: '2026-01', sourceFile: id+'.pdf', importedAt: NOW,
  }).run();
  db.insert(schema.securityPurposes).values({
    id: id+'-sp', accountId: id, securityId: id+'-sec', purpose: 'portfolio', createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('deleteAccountData', () => {
  it('deletes the account and all rows referencing it', () => {
    const { db } = makeTmpDb();
    seedAccount(db, 'a1');
    seedAccount(db, 'a2'); // sibling must survive
    const res = deleteAccountData('a1', db);
    expect(res.deleted).toBe(true);
    expect(db.select().from(schema.accounts).all().map((a) => a.id)).toEqual(['a2']);
    expect(db.select().from(schema.cashFlows).all().every((r) => r.accountId === 'a2')).toBe(true);
    expect(db.select().from(schema.investmentTransactions).all().every((r) => r.accountId === 'a2')).toBe(true);
    expect(db.select().from(schema.investmentSnapshots).all().every((r) => r.accountId === 'a2')).toBe(true);
    expect(db.select().from(schema.snapshotHoldings).all().map((h) => h.snapshotId)).toEqual(['a2-s']);
    expect(db.select().from(schema.transactions).all().every((r) => r.accountId === 'a2')).toBe(true);
    expect(db.select().from(schema.monthlyAggregates).all().every((r) => r.accountId === 'a2')).toBe(true);
    expect(db.select().from(schema.statementImports).all().every((r) => r.accountId === 'a2')).toBe(true);
    expect(db.select().from(schema.securityPurposes).all().every((r) => r.accountId === 'a2')).toBe(true);
  });
  it('returns {deleted:false} for an unknown account', () => {
    const { db } = makeTmpDb();
    expect(deleteAccountData('nope', db).deleted).toBe(false);
  });
});
