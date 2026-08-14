import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, securities, investmentSnapshots, snapshotHoldings, cashFlows, securityPurposes } from '@/db/schema';
import { eq } from 'drizzle-orm';

const NOW = '2026-08-03T00:00:00.000Z';

function seedAccount(db: ReturnType<typeof makeTmpDb>['db'], id = 'a1', purpose = 'portfolio') {
  db.insert(accounts).values({
    id, name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose,
    createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('investment schema', () => {
  it('accounts.purpose defaults to portfolio', () => {
    const { db } = makeTmpDb();
    db.insert(accounts).values({
      id: 'a0', name: 'X', institution: 'Y', accountClass: 'investment',
      type: 'investment', origin: 'manual', status: 'active',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    const row = db.select().from(accounts).where(eq(accounts.id, 'a0')).get();
    expect(row?.purpose).toBe('portfolio');
  });

  it('stores a snapshot with holdings', () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    db.insert(securities).values({
      id: 's1', ticker: 'VTI', name: 'Vanguard Total Stock Market ETF',
      kind: 'etf', assetType: 'equity', tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(investmentSnapshots).values({
      id: 'sn1', accountId: 'a1', asOf: '2026-07-31', month: '2026-07',
      source: 'paste', totalValue: 1000, holdingsComplete: true,
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(snapshotHoldings).values({
      id: 'h1', snapshotId: 'sn1', securityId: 's1', quantity: 4, value: 1000,
    }).run();

    const held = db.select().from(snapshotHoldings).where(eq(snapshotHoldings.snapshotId, 'sn1')).all();
    expect(held).toHaveLength(1);
    expect(held[0].value).toBe(1000);
    expect(held[0].quantity).toBe(4);
  });

  it('rejects two snapshots for the same account and date', () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    const row = {
      accountId: 'a1', asOf: '2026-07-31', month: '2026-07', source: 'paste',
      totalValue: 1, holdingsComplete: false, createdAt: NOW, modifiedAt: NOW,
    };
    db.insert(investmentSnapshots).values({ id: 'x1', ...row }).run();
    expect(() => db.insert(investmentSnapshots).values({ id: 'x2', ...row }).run()).toThrow();
  });

  it('allows several securities with a null ticker but not duplicate tickers', () => {
    const { db } = makeTmpDb();
    const base = { kind: 'other', assetType: 'cash', tagSource: 'seed', createdAt: NOW, modifiedAt: NOW };
    db.insert(securities).values({ id: 'n1', ticker: null, name: 'Stable Value Fund', ...base }).run();
    db.insert(securities).values({ id: 'n2', ticker: null, name: 'RMB Money Fund', ...base }).run();
    expect(db.select().from(securities).all()).toHaveLength(2);

    db.insert(securities).values({ id: 't1', ticker: 'VGT', name: 'Vanguard IT', ...base }).run();
    expect(() =>
      db.insert(securities).values({ id: 't2', ticker: 'VGT', name: 'dup', ...base }).run()
    ).toThrow();
  });

  it('stores dated cash flows and per-security purpose overrides', () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    db.insert(securities).values({
      id: 's9', ticker: 'VMFXX', name: 'Vanguard Federal Money Market',
      kind: 'mutual_fund', assetType: 'money_market', tagSource: 'seed',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(securityPurposes).values({
      id: 'sp1', accountId: 'a1', securityId: 's9', purpose: 'reserve',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(cashFlows).values({
      id: 'cf1', accountId: 'a1', date: '2026-07-15', amount: 500,
      kind: 'contribution', source: 'manual', confirmed: true,
      createdAt: NOW, modifiedAt: NOW,
    }).run();

    expect(db.select().from(securityPurposes).all()[0].purpose).toBe('reserve');
    expect(db.select().from(cashFlows).all()[0].amount).toBe(500);
  });
});
