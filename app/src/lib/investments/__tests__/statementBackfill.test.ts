import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';
import { loadPortfolioContext } from '@/lib/investments/read';
import { isEmptyCloseoutStatement } from '@/lib/investments/statementBackfill';

const NOW = '2026-08-06T00:00:00.000Z';

function addAccount(db: ReturnType<typeof makeTmpDb>['db'], id: string) {
  db.insert(schema.accounts).values({
    id, name: id, institution: 'Fidelity', accountClass: 'investment', type: 'investment',
    origin: 'manual', status: 'active', purpose: 'portfolio', owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
}
function addFlow(db: ReturnType<typeof makeTmpDb>['db'], over: Partial<typeof schema.cashFlows.$inferInsert> & { id: string; accountId: string }) {
  db.insert(schema.cashFlows).values({
    id: over.id, accountId: over.accountId, securityId: over.securityId ?? null,
    date: over.date ?? '2025-03-15', amount: over.amount ?? 100, kind: over.kind ?? 'contribution',
    source: over.source ?? 'plaid', confirmed: over.confirmed ?? true, note: '',
    supersededBy: over.supersededBy ?? null, createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('supersededBy read filter', () => {
  it('excludes superseded flows from loadPortfolioContext', async () => {
    const { db } = makeTmpDb();
    addAccount(db, 'a1');
    addFlow(db, { id: 'live', accountId: 'a1' });
    addFlow(db, { id: 'gone', accountId: 'a1', supersededBy: 'live' });
    const ctx = await loadPortfolioContext(db);
    expect(ctx.flows.map((f) => f.id)).toEqual(['live']);
  });
});

import { parseStatementExtraction, reconcileStatement } from '@/lib/investments/statementBackfill';
import { ReconciliationError } from '@/lib/investments/snapshots';

describe('parseStatementExtraction', () => {
  const raw = {
    institution: 'Fidelity', accountMask: '1234', asOf: '2025-03-31', reportedTotal: 300,
    holdings: [{ ticker: 'VONG', name: 'Vanguard Growth', quantity: 2, value: 200 },
               { ticker: 'SPAXX', name: 'Cash', quantity: null, value: 100 }],
    transactions: [
      { date: '2025-03-15', subtype: 'contribution', amount: 50 },
      { date: '2025-03-20', subtype: 'buy', amount: 200 },        // skipped
      { date: '2025-03-25', subtype: 'dividend', amount: 3 },     // skipped
      { date: '2025-03-28', subtype: 'withdrawal', amount: 10 },
    ],
  };

  it('normalizes account ref, holdings, and only external flows', () => {
    const s = parseStatementExtraction(raw)[0];
    expect(s.accountRef).toEqual({ institution: 'Fidelity', mask: '1234', planName: null });
    expect(s.asOf).toBe('2025-03-31');
    expect(s.holdings.map((h) => h.ticker)).toEqual(['VONG', 'SPAXX']);
    expect(s.flows).toEqual([
      { date: '2025-03-15', amount: 50, kind: 'contribution' },
      { date: '2025-03-28', amount: -10, kind: 'withdrawal' },
    ]);
  });

  it('normalizes an activity section (buy/sell/reinvest), coercing types and dropping malformed rows', () => {
    const withActivity = {
      ...raw,
      activity: [
        { date: '2025-03-10', ticker: 'VONG', name: 'Vanguard Growth', type: 'buy', amount: 500 },
        { date: '2025-03-12', ticker: 'VONG', name: 'Vanguard Growth', type: 'reinvest', amount: 3 },
        { date: '2025-03-20', ticker: 'SPAXX', name: 'Cash', type: 'sell', amount: -200 },
        { date: '2025-03-22', ticker: 'VONG', name: 'Vanguard Growth', type: 'spinoff', amount: 1 }, // unknown -> 'other'
        { date: '2025-03-25', ticker: 'X', name: 'Bad', type: 'buy', amount: 'oops' }, // malformed amount -> dropped
        { ticker: 'Y', name: 'NoDate', type: 'buy', amount: 5 },                        // missing date -> dropped
      ],
    };
    const s = parseStatementExtraction(withActivity)[0];
    expect(s.activity).toEqual([
      { date: '2025-03-10', ticker: 'VONG', name: 'Vanguard Growth', type: 'buy', amount: 500 },
      { date: '2025-03-12', ticker: 'VONG', name: 'Vanguard Growth', type: 'reinvest', amount: 3 },
      { date: '2025-03-20', ticker: 'SPAXX', name: 'Cash', type: 'sell', amount: -200 },
      { date: '2025-03-22', ticker: 'VONG', name: 'Vanguard Growth', type: 'other', amount: 1 },
    ]);
  });

  it('defaults activity to [] when the field is absent', () => {
    expect(parseStatementExtraction(raw)[0].activity).toEqual([]);
  });

  it('throws on missing asOf or non-array holdings', () => {
    expect(() => parseStatementExtraction({ ...raw, asOf: undefined })).toThrow();
    expect(() => parseStatementExtraction({ ...raw, holdings: 'x' })).toThrow();
  });

  it('parses a multi-account payload into one ParsedStatement per account', () => {
    const acctA = { ...raw, institution: 'Fidelity', accountMask: '1111' };
    const acctB = { ...raw, institution: 'Vanguard', accountMask: '2222' };
    const results = parseStatementExtraction({ accounts: [acctA, acctB] });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.accountRef)).toEqual([
      { institution: 'Fidelity', mask: '1111', planName: null },
      { institution: 'Vanguard', mask: '2222', planName: null },
    ]);
  });
});

describe('reconcileStatement', () => {
  it('passes when holdings sum matches reportedTotal', () => {
    const s = parseStatementExtraction({ institution: 'F', accountMask: '1', asOf: '2025-03-31', reportedTotal: 300,
      holdings: [{ ticker: 'A', name: 'A', quantity: 1, value: 300 }], transactions: [] })[0];
    expect(() => reconcileStatement(s)).not.toThrow();
  });
  it('throws ReconciliationError on a large mismatch', () => {
    const s = parseStatementExtraction({ institution: 'F', accountMask: '1', asOf: '2025-03-31', reportedTotal: 300,
      holdings: [{ ticker: 'A', name: 'A', quantity: 1, value: 100 }], transactions: [] })[0];
    expect(() => reconcileStatement(s)).toThrow(ReconciliationError);
  });
});

import { importStatement, resolveOrCreateStatementAccount, STATEMENT_SUPERSEDED } from '@/lib/investments/statementBackfill';

function baseStatement(mask: string): ReturnType<typeof parseStatementExtraction>[number] {
  return parseStatementExtraction({
    institution: 'Fidelity', accountMask: mask, planName: null, asOf: '2025-03-31', reportedTotal: 300,
    holdings: [{ ticker: 'VONG', name: 'Vanguard Growth', quantity: 2, value: 300 }],
    transactions: [{ date: '2025-03-15', subtype: 'contribution', amount: 50 }],
  })[0];
}

describe('importStatement', () => {
  it('supersedes ALL of the account\'s Plaid flows — statements are authoritative', async () => {
    const { db } = makeTmpDb();
    db.insert(schema.accounts).values({ id: 'f1', name: '401k', institution: 'Fidelity', mask: '1234',
      accountClass: 'investment', type: 'investment', origin: 'plaid', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW }).run();
    // A Plaid flow matching the statement deposit, and an unrelated one — BOTH are superseded,
    // because the account now has a statement and statements own its flows entirely.
    addFlow(db, { id: 'plaid-match', accountId: 'f1', date: '2025-03-16', amount: 50, kind: 'contribution', source: 'plaid' });
    addFlow(db, { id: 'plaid-other', accountId: 'f1', date: '2025-05-01', amount: 999, kind: 'contribution', source: 'plaid' });

    const s = baseStatement('1234');
    const { accountId } = resolveOrCreateStatementAccount(s.accountRef, db);
    const res = await importStatement(s, accountId, db);
    expect(res.superseded).toBe(2);

    const rows = Object.fromEntries(db.select().from(schema.cashFlows).all().map((f) => [f.id, f]));
    expect(rows['plaid-match'].supersededBy).toBe(STATEMENT_SUPERSEDED);
    expect(rows['plaid-other'].supersededBy).toBe(STATEMENT_SUPERSEDED);
    const stmt = db.select().from(schema.cashFlows).all().find((f) => f.source === 'statement');
    expect(stmt).toMatchObject({ amount: 50, kind: 'contribution', accountId: 'f1' });
    expect(stmt!.supersededBy).toBeNull();   // the statement flow itself stays live
    expect(db.select().from(schema.investmentSnapshots).all().some((x) => x.accountId === 'f1')).toBe(true);
  });

  it('persists statement activity as investment_transactions (securities resolved, reinvest flagged, idempotent)', async () => {
    const { db } = makeTmpDb();
    db.insert(schema.accounts).values({ id: 'v1', name: 'Brokerage', institution: 'Vanguard', mask: '5693',
      accountClass: 'investment', type: 'investment', origin: 'plaid', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW }).run();
    const s = parseStatementExtraction({
      institution: 'Vanguard', accountMask: '5693', asOf: '2026-06-30', reportedTotal: 300,
      holdings: [{ ticker: 'VONG', name: 'Vanguard Growth', quantity: 2, value: 300 }],
      transactions: [],
      activity: [
        { date: '2026-06-01', ticker: 'VONG', name: 'Vanguard Growth', type: 'buy', amount: 500 },
        { date: '2026-06-10', ticker: 'VONG', name: 'Vanguard Growth', type: 'reinvest', amount: 3 },
        { date: '2026-06-20', ticker: 'SPAXX', name: 'Cash', type: 'sell', amount: -200 },
      ],
    })[0];
    const { accountId } = resolveOrCreateStatementAccount(s.accountRef, db);
    await importStatement(s, accountId, db);
    const txns = db.select().from(schema.investmentTransactions).all();
    expect(txns.length).toBe(3);
    expect(txns.some((tr) => tr.type === 'buy' && tr.amount === 500 && !tr.name.startsWith('REINVESTMENT'))).toBe(true);
    expect(txns.some((tr) => tr.type === 'buy' && tr.name.startsWith('REINVESTMENT'))).toBe(true); // reinvest → buy + flag
    expect(txns.some((tr) => tr.type === 'sell' && tr.amount === -200)).toBe(true);
    expect(txns.every((tr) => tr.securityId)).toBe(true);
    await importStatement(s, accountId, db); // idempotent
    expect(db.select().from(schema.investmentTransactions).all().length).toBe(3);
  });

  it('skips statement activity when the account already has Plaid buy/sell coverage (no double-count)', async () => {
    const { db } = makeTmpDb();
    db.insert(schema.accounts).values({ id: 'f2', name: 'Brokerage', institution: 'Fidelity', mask: '4366',
      accountClass: 'investment', type: 'investment', origin: 'plaid', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW }).run();
    // Pre-existing Plaid buy txn on this account.
    db.insert(schema.investmentTransactions).values({ id: 'p1', accountId: 'f2', plaidInvestmentTxnId: 'plaid-x',
      securityId: null, date: '2026-06-01', name: 'YOU BOUGHT', amount: 100, quantity: null, price: null, fees: null,
      type: 'buy', subtype: 'buy', createdAt: NOW, modifiedAt: NOW }).run();
    const s = parseStatementExtraction({
      institution: 'Fidelity', accountMask: '4366', asOf: '2026-06-30', reportedTotal: 300,
      holdings: [{ ticker: 'VONG', name: 'Vanguard Growth', quantity: 2, value: 300 }], transactions: [],
      activity: [{ date: '2026-06-05', ticker: 'VONG', name: 'Vanguard Growth', type: 'buy', amount: 500 }],
    })[0];
    const { accountId } = resolveOrCreateStatementAccount(s.accountRef, db);
    await importStatement(s, accountId, db);
    // Only the original Plaid txn remains — the statement activity was skipped.
    expect(db.select().from(schema.investmentTransactions).all().length).toBe(1);
  });

  it('still stores statement activity when the account only has Plaid reinvestment buys (Vanguard case)', async () => {
    const { db } = makeTmpDb();
    db.insert(schema.accounts).values({ id: 'v2', name: 'Brokerage', institution: 'Vanguard', mask: '5693',
      accountClass: 'investment', type: 'investment', origin: 'plaid', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW }).run();
    // Only reinvestment buys from Plaid — NOT real exchange coverage.
    db.insert(schema.investmentTransactions).values({ id: 'r1', accountId: 'v2', plaidInvestmentTxnId: 'plaid-r',
      securityId: null, date: '2026-06-01', name: 'VUSXX VANGUARD Reinvestment', amount: 255, quantity: null, price: null, fees: null,
      type: 'buy', subtype: 'buy', createdAt: NOW, modifiedAt: NOW }).run();
    const s = parseStatementExtraction({
      institution: 'Vanguard', accountMask: '5693', asOf: '2026-06-30', reportedTotal: 300,
      holdings: [{ ticker: 'VONG', name: 'Vanguard Growth', quantity: 2, value: 300 }], transactions: [],
      activity: [{ date: '2026-06-05', ticker: 'VONG', name: 'Vanguard Growth', type: 'buy', amount: 500 }],
    })[0];
    const { accountId } = resolveOrCreateStatementAccount(s.accountRef, db);
    await importStatement(s, accountId, db);
    expect(db.select().from(schema.investmentTransactions).all().some((tr) => tr.plaidInvestmentTxnId.startsWith('stmt:'))).toBe(true);
  });

  it('is idempotent for supersession: a re-import supersedes nothing new', async () => {
    const { db } = makeTmpDb();
    db.insert(schema.accounts).values({ id: 'f1', name: '401k', institution: 'Fidelity', mask: '1234',
      accountClass: 'investment', type: 'investment', origin: 'plaid', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW }).run();
    addFlow(db, { id: 'plaid-1', accountId: 'f1', date: '2025-03-16', amount: 50, kind: 'contribution', source: 'plaid' });
    const s = baseStatement('1234');
    const { accountId } = resolveOrCreateStatementAccount(s.accountRef, db);
    expect((await importStatement(s, accountId, db)).superseded).toBe(1);
    expect((await importStatement(s, accountId, db)).superseded).toBe(0);
  });

  it('is idempotent: a second import does not duplicate the statement flow', async () => {
    const { db } = makeTmpDb();
    db.insert(schema.accounts).values({ id: 'f1', name: '401k', institution: 'Fidelity', mask: '1234',
      accountClass: 'investment', type: 'investment', origin: 'plaid', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW }).run();
    const s = baseStatement('1234');
    const { accountId } = resolveOrCreateStatementAccount(s.accountRef, db);
    await importStatement(s, accountId, db);
    await importStatement(s, accountId, db);
    const stmtFlows = db.select().from(schema.cashFlows).all().filter((f) => f.source === 'statement');
    expect(stmtFlows.length).toBe(1);
  });

  it('commits value-authoritative (stated total, no throw) when holdings do not reconcile', async () => {
    const { db } = makeTmpDb();
    db.insert(schema.accounts).values({ id: 'f1', name: 'Brokerage', institution: 'Vanguard', mask: '5693',
      accountClass: 'investment', type: 'investment', origin: 'plaid', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW }).run();
    // Reported 50069.56 but holdings sum 98069.54 (a pending, unsettled transfer inflates the money-market holding).
    const s = parseStatementExtraction({
      institution: 'Vanguard', accountMask: '5693', asOf: '2026-01-31', reportedTotal: 50069.56,
      holdings: [{ ticker: 'VUSXX', name: 'Vanguard Treasury MM', quantity: 98069.54, value: 98069.54 }],
      transactions: [],
    })[0];
    const { accountId } = resolveOrCreateStatementAccount(s.accountRef, db);
    const res = await importStatement(s, accountId, db);
    expect(res.reconciled).toBe(false);
    const snap = db.select().from(schema.investmentSnapshots).all().find((x) => x.accountId === accountId && x.asOf === '2026-01-31')!;
    expect(Math.round(snap.totalValue)).toBe(50070);   // stated total kept, not the 98k holdings sum
    expect(snap.holdingsComplete).toBe(false);          // mismatch is flagged, not absorbed
  });

  it('normalizes withdrawal sign and supersedes matching Plaid withdrawal', async () => {
    const { db } = makeTmpDb();
    db.insert(schema.accounts).values({ id: 'f1', name: '401k', institution: 'Fidelity', mask: '1234',
      accountClass: 'investment', type: 'investment', origin: 'plaid', status: 'active', purpose: 'portfolio',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW }).run();
    // A Plaid withdrawal: the way deriveCashFlow produces it (negative amount).
    addFlow(db, { id: 'plaid-withdraw', accountId: 'f1', date: '2025-03-17', amount: -75, kind: 'withdrawal', source: 'plaid' });

    // Statement with a withdrawal (raw amount 75, should be normalized to -75).
    const stmt = parseStatementExtraction({
      institution: 'Fidelity', accountMask: '1234', asOf: '2025-03-31', reportedTotal: 300,
      holdings: [{ ticker: 'VONG', name: 'Vanguard Growth', quantity: 2, value: 300 }],
      transactions: [{ date: '2025-03-15', subtype: 'withdrawal', amount: 75 }],
    })[0];
    const { accountId } = resolveOrCreateStatementAccount(stmt.accountRef, db);
    const res = await importStatement(stmt, accountId, db);

    // Plaid withdrawal superseded (statements own the account).
    expect(res.superseded).toBe(1);

    const rows = Object.fromEntries(db.select().from(schema.cashFlows).all().map((f) => [f.id, f]));
    expect(rows['plaid-withdraw'].supersededBy).toBe(STATEMENT_SUPERSEDED);
    const stmtFlow = db.select().from(schema.cashFlows).all().find((f) => f.source === 'statement');
    expect(stmtFlow).toMatchObject({ amount: -75, kind: 'withdrawal', source: 'statement' });
  });
});

import { deleteLegacyAccount } from '@/lib/investments/statementBackfill';

describe('deleteLegacyAccount', () => {
  it('removes the Legacy account and its snapshots/holdings/flows, leaving others intact', async () => {
    const { db } = makeTmpDb();
    db.insert(schema.accounts).values({ id: 'legacy', name: 'Household Portfolio', institution: 'Legacy',
      accountClass: 'investment', type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
      owner: '', createdAt: NOW, modifiedAt: NOW }).run();
    addAccount(db, 'real');
    const snapId = 'snap1';
    db.insert(schema.investmentSnapshots).values({ id: snapId, accountId: 'legacy', asOf: '2025-03-31',
      month: '2025-03', source: 'legacy', totalValue: 100, holdingsComplete: true, createdAt: NOW, modifiedAt: NOW }).run();
    db.insert(schema.securities).values({ id: 'sec1', ticker: 'VONG', name: 'Vanguard Growth', kind: 'etf', assetType: 'equity', createdAt: NOW, modifiedAt: NOW }).run();
    db.insert(schema.snapshotHoldings).values({ id: 'h1', snapshotId: snapId, securityId: 'sec1', quantity: 1, value: 100 }).run();
    addFlow(db, { id: 'lf', accountId: 'legacy', source: 'legacy' });
    addFlow(db, { id: 'rf', accountId: 'real', source: 'plaid' });

    const res = deleteLegacyAccount(db);
    expect(res.deleted).toBe(true);
    expect(db.select().from(schema.accounts).all().map((a) => a.id)).toEqual(['real']);
    expect(db.select().from(schema.investmentSnapshots).all().length).toBe(0);
    expect(db.select().from(schema.snapshotHoldings).all().length).toBe(0);
    expect(db.select().from(schema.cashFlows).all().map((f) => f.id)).toEqual(['rf']);
  });

  it('is a no-op when there is no Legacy account', () => {
    const { db } = makeTmpDb();
    addAccount(db, 'real');
    expect(deleteLegacyAccount(db).deleted).toBe(false);
  });
});

function addInvAccount(db: ReturnType<typeof makeTmpDb>['db'], over: { id: string; institution: string; name: string; mask?: string | null }) {
  db.insert(schema.accounts).values({
    id: over.id, name: over.name, institution: over.institution, mask: over.mask ?? null,
    accountClass: 'investment', type: 'investment', origin: 'plaid', status: 'active',
    purpose: 'portfolio', owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('resolveOrCreateStatementAccount', () => {
  it('resolves by mask (brokerage/IRA/Roth/Vanguard)', () => {
    const { db } = makeTmpDb();
    addInvAccount(db, { id: 'fb', institution: 'Fidelity', name: 'Brokerage', mask: '4366' });
    const r = resolveOrCreateStatementAccount({ institution: 'Fidelity', mask: '4366', planName: null }, db);
    expect(r).toEqual({ accountId: 'fb', created: false });
  });

  it('resolves a 401k by plan-name substring when there is no mask', () => {
    const { db } = makeTmpDb();
    addInvAccount(db, { id: 'iron', institution: 'Fidelity', name: '401k Ironclad', mask: '1981' });
    const r = resolveOrCreateStatementAccount({ institution: 'Fidelity', mask: null, planName: 'Ironclad' }, db);
    expect(r).toEqual({ accountId: 'iron', created: false });
  });

  it('auto-creates an investment/portfolio account when unresolved', () => {
    const { db } = makeTmpDb();
    const r = resolveOrCreateStatementAccount({ institution: 'Fidelity', mask: null, planName: 'Acme' }, db);
    expect(r.created).toBe(true);
    const acct = db.select().from(schema.accounts).all().find((a) => a.id === r.accountId)!;
    expect(acct).toMatchObject({ name: '401k Acme', accountClass: 'investment', purpose: 'portfolio', origin: 'statement' });
    expect(acct.institution).toBe('Fidelity');
  });

  it('throws when a mask matches more than one investment account', () => {
    const { db } = makeTmpDb();
    addInvAccount(db, { id: 'a', institution: 'Fidelity', name: 'One', mask: '4366' });
    addInvAccount(db, { id: 'b', institution: 'Fidelity', name: 'Two', mask: '4366' });
    expect(() => resolveOrCreateStatementAccount({ institution: 'Fidelity', mask: '4366', planName: null }, db)).toThrow();
  });

  it('falls through to plan-name when a mask is present but matches nothing, instead of auto-creating a duplicate', () => {
    const { db } = makeTmpDb();
    addInvAccount(db, { id: 'iron', institution: 'Fidelity', name: '401k Ironclad', mask: '1981' });
    // mask '9999' matches no accounts; the model also filled planName 'Ironclad', which does match.
    const r = resolveOrCreateStatementAccount({ institution: 'Fidelity', mask: '9999', planName: 'Ironclad' }, db);
    expect(r).toEqual({ accountId: 'iron', created: false });
  });
});

import { resolveStatementAccount } from '@/lib/investments/statementBackfill';

const T = '2026-08-07T00:00:00.000Z';

describe('resolveStatementAccount (read-only)', () => {
  it('matches by exact mask', () => {
    const { db } = makeTmpDb();
    addInvAccount(db, { id: 'a1', institution: 'Vanguard', name: 'Brokerage', mask: '5693' });
    const r = resolveStatementAccount({ institution: 'Vanguard', mask: '5693', planName: null }, db);
    expect(r).toEqual({ accountId: 'a1', name: 'Brokerage' });
  });
  it('matches by plan-name substring (institution-scoped)', () => {
    const { db } = makeTmpDb();
    addInvAccount(db, { id: 'a2', institution: 'Fidelity', name: '401k Acme', mask: null });
    const r = resolveStatementAccount({ institution: 'Fidelity', mask: null, planName: 'Acme' }, db);
    expect(r).toEqual({ accountId: 'a2', name: '401k Acme' });
  });
  it('returns null when nothing matches', () => {
    const { db } = makeTmpDb();
    addInvAccount(db, { id: 'a1', institution: 'Vanguard', name: 'Brokerage', mask: '5693' });
    expect(resolveStatementAccount({ institution: 'Fidelity', mask: '9999', planName: null }, db)).toBeNull();
  });
  it('throws when a mask matches more than one account', () => {
    const { db } = makeTmpDb();
    addInvAccount(db, { id: 'a1', institution: 'Vanguard', name: 'Brokerage A', mask: '5693' });
    addInvAccount(db, { id: 'a2', institution: 'Vanguard', name: 'Brokerage B', mask: '5693' });
    expect(() => resolveStatementAccount({ institution: 'Vanguard', mask: '5693', planName: null }, db)).toThrow(/matched 2/);
  });
  it('resolveOrCreateStatementAccount reuses the resolver (no dup create on match)', () => {
    const { db } = makeTmpDb();
    addInvAccount(db, { id: 'a1', institution: 'Vanguard', name: 'Brokerage', mask: '5693' });
    const r = resolveOrCreateStatementAccount({ institution: 'Vanguard', mask: '5693', planName: null }, db);
    expect(r).toEqual({ accountId: 'a1', created: false });
    expect(db.select().from(schema.accounts).all().length).toBe(1);
  });
});

import { buildImportPlan } from '@/lib/investments/statementBackfill';
import type { ParsedStatement } from '@/lib/investments/statementBackfill';

function stmt(over: Partial<ParsedStatement> & { accountRef: ParsedStatement['accountRef']; asOf: string; reportedTotal: number }): ParsedStatement {
  return { holdings: [], flows: [], activity: [], ...over };
}

import { commitStatements, assertValidStatements } from '@/lib/investments/statementBackfill';

describe('commitStatements', () => {
  it('creates the account, writes a snapshot, records flows', async () => {
    const { db } = makeTmpDb();
    const results = await commitStatements([stmt({
      accountRef: { institution: 'Fidelity', mask: null, planName: 'Acme' },
      asOf: '2025-03-31', reportedTotal: 300,
      holdings: [{ ticker: 'FXAIX', name: '500 Index', quantity: 1, value: 300 }],
      flows: [{ date: '2025-03-10', amount: 50, kind: 'contribution' }],
    })], db);
    expect(results[0]).toMatchObject({ created: true, flows: 1, reconciled: true });
    const accts = db.select().from(schema.accounts).all();
    expect(accts.length).toBe(1);
    const snaps = db.select().from(schema.investmentSnapshots).all();
    expect(snaps.length).toBe(1);
  });
  it('supersedes live plaid flows on the resolved account', async () => {
    const { db } = makeTmpDb();
    addInvAccount(db, { id: 'a1', institution: 'Vanguard', name: 'Brokerage', mask: '5693' });
    addFlow(db, { id: 'p1', accountId: 'a1', source: 'plaid' });
    const results = await commitStatements([stmt({
      accountRef: { institution: 'Vanguard', mask: '5693', planName: null },
      asOf: '2025-03-31', reportedTotal: 0,
    })], db);
    expect(results[0].superseded).toBe(1);
    const live = db.select().from(schema.cashFlows).all().filter((x) => x.source === 'plaid' && x.supersededBy === null);
    expect(live.length).toBe(0);
  });
  it('is idempotent on re-commit (no duplicate snapshots or flows)', async () => {
    const { db } = makeTmpDb();
    const s = stmt({
      accountRef: { institution: 'Fidelity', mask: null, planName: 'Acme' },
      asOf: '2025-03-31', reportedTotal: 300,
      holdings: [{ ticker: 'FXAIX', name: '500 Index', quantity: 1, value: 300 }],
      flows: [{ date: '2025-03-10', amount: 50, kind: 'contribution' }],
    });
    await commitStatements([s], db);
    await commitStatements([s], db); // resolves to the same account now
    expect(db.select().from(schema.investmentSnapshots).all().length).toBe(1);
    expect(db.select().from(schema.cashFlows).all().filter((x) => x.source === 'statement').length).toBe(1);
  });
  it('throws when two statements resolve to the same account', async () => {
    const { db } = makeTmpDb();
    addInvAccount(db, { id: 'a1', institution: 'Vanguard', name: 'Brokerage', mask: '5693' });
    const s = stmt({ accountRef: { institution: 'Vanguard', mask: '5693', planName: null }, asOf: '2025-03-31', reportedTotal: 0 });
    await expect(commitStatements([s, s], db)).rejects.toThrow(/same account/);
    // Pre-flight: nothing should have been written for the pre-existing account either.
    expect(db.select().from(schema.investmentSnapshots).all().length).toBe(0);
  });
  it('is all-or-nothing: two identical to-be-created refs fail before any account is created', async () => {
    const { db } = makeTmpDb();
    const s = stmt({
      accountRef: { institution: 'Fidelity', mask: null, planName: 'Acme' },
      asOf: '2025-03-31', reportedTotal: 300,
      holdings: [{ ticker: 'FXAIX', name: '500 Index', quantity: 1, value: 300 }],
      flows: [{ date: '2025-03-10', amount: 50, kind: 'contribution' }],
    });
    await expect(commitStatements([s, s], db)).rejects.toThrow(/same account/);
    expect(db.select().from(schema.accounts).all().length).toBe(0);
  });
});

describe('assertValidStatements', () => {
  it('accepts a well-formed ParsedStatement array', () => {
    expect(() => assertValidStatements([stmt({
      accountRef: { institution: 'Vanguard', mask: '5693', planName: null }, asOf: '2025-03-31', reportedTotal: 1,
    })])).not.toThrow();
  });
  it('rejects a non-array', () => {
    expect(() => assertValidStatements({})).toThrow();
  });
  it('rejects an entry missing accountRef/asOf/reportedTotal', () => {
    expect(() => assertValidStatements([{ asOf: '2025-03-31', reportedTotal: 1 }])).toThrow();
    expect(() => assertValidStatements([{ accountRef: { institution: 'X', mask: null, planName: null }, reportedTotal: 1 }])).toThrow();
  });
});

describe('buildImportPlan', () => {
  it('flags an existing account as willCreate=false with its name', () => {
    const { db } = makeTmpDb();
    addInvAccount(db, { id: 'a1', institution: 'Vanguard', name: 'Brokerage', mask: '5693' });
    const plan = buildImportPlan([stmt({
      accountRef: { institution: 'Vanguard', mask: '5693', planName: null },
      asOf: '2025-03-31', reportedTotal: 300,
      holdings: [{ ticker: 'VTSAX', name: 'Total Stock', quantity: 2, value: 300 }],
      flows: [{ date: '2025-03-10', amount: 50, kind: 'contribution' }],
    })], db);
    expect(plan[0]).toMatchObject({
      institution: 'Vanguard', mask: '5693', willCreateAccount: false,
      existingAccountName: 'Brokerage', holdingsReconciled: true, flowCount: 1,
    });
  });
  it('flags an unknown account as willCreate=true', () => {
    const { db } = makeTmpDb();
    const plan = buildImportPlan([stmt({
      accountRef: { institution: 'Fidelity', mask: null, planName: 'Acme' },
      asOf: '2025-03-31', reportedTotal: 100,
    })], db);
    expect(plan[0]).toMatchObject({ willCreateAccount: true, existingAccountName: null, plaidFlowsToSupersede: 0 });
  });
  it('reports holdingsReconciled=false when holdings disagree with the total', () => {
    const { db } = makeTmpDb();
    const plan = buildImportPlan([stmt({
      accountRef: { institution: 'Fidelity', mask: null, planName: 'Acme' },
      asOf: '2025-03-31', reportedTotal: 1000,
      holdings: [{ ticker: null, name: 'Fund', quantity: null, value: 200 }],
    })], db);
    expect(plan[0].holdingsReconciled).toBe(false);
  });
  it('counts live plaid flows the commit would supersede', () => {
    const { db } = makeTmpDb();
    addInvAccount(db, { id: 'a1', institution: 'Vanguard', name: 'Brokerage', mask: '5693' });
    addFlow(db, { id: 'p1', accountId: 'a1', source: 'plaid' });
    addFlow(db, { id: 'p2', accountId: 'a1', source: 'plaid' });
    addFlow(db, { id: 'p3', accountId: 'a1', source: 'plaid', supersededBy: 'x' }); // already gone
    const plan = buildImportPlan([stmt({
      accountRef: { institution: 'Vanguard', mask: '5693', planName: null },
      asOf: '2025-03-31', reportedTotal: 0,
    })], db);
    expect(plan[0].plaidFlowsToSupersede).toBe(2);
  });
});

describe('isEmptyCloseoutStatement', () => {
  const base = {
    accountRef: { institution: 'US Bank', mask: '3102', planName: null },
    asOf: '2026-02-27', reportedTotal: 0, holdings: [], flows: [], activity: [],
  };
  it('flags a zero-value statement with no holdings (a closed/emptied account)', () => {
    expect(isEmptyCloseoutStatement(base)).toBe(true);
  });
  it('does not flag a zero-value statement that still lists holdings', () => {
    expect(isEmptyCloseoutStatement({ ...base, holdings: [{ ticker: 'VOO', name: 'VOO', quantity: 1, value: 0 }] })).toBe(false);
  });
  it('does not flag a normal statement', () => {
    expect(isEmptyCloseoutStatement({ ...base, reportedTotal: 186371.47 })).toBe(false);
  });
});
