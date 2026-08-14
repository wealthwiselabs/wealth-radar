import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';
import { eq } from 'drizzle-orm';

const NOW = '2026-08-06T00:00:00.000Z';

function seedAccount(db: ReturnType<typeof makeTmpDb>['db'], id = 'acc1') {
  db.insert(schema.accounts).values({
    id, name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
    type: 'investment', origin: 'plaid', plaidAccountId: `pa-${id}`, status: 'active',
    purpose: 'portfolio', owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
  return id;
}

describe('investment_transactions schema', () => {
  it('stores a raw investment transaction and a cash_flow.sourceRef', () => {
    const { db } = makeTmpDb();
    const accountId = seedAccount(db);

    db.insert(schema.investmentTransactions).values({
      id: 'it1', accountId, plaidInvestmentTxnId: 'ptxn-1', securityId: null,
      date: '2026-07-15', name: 'CONTRIBUTION', amount: -500, quantity: null, price: null, fees: null,
      type: 'cash', subtype: 'contribution', createdAt: NOW, modifiedAt: NOW,
    }).run();

    db.insert(schema.cashFlows).values({
      id: 'cf1', accountId, securityId: null, date: '2026-07-15', amount: 500,
      kind: 'contribution', source: 'plaid', confirmed: true, sourceRef: 'it1',
      note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();

    const raw = db.select().from(schema.investmentTransactions).where(eq(schema.investmentTransactions.plaidInvestmentTxnId, 'ptxn-1')).get();
    expect(raw).toMatchObject({ id: 'it1', accountId, amount: -500, subtype: 'contribution' });
    const flow = db.select().from(schema.cashFlows).where(eq(schema.cashFlows.sourceRef, 'it1')).get();
    expect(flow).toMatchObject({ amount: 500, kind: 'contribution', sourceRef: 'it1' });
  });
});

import { deriveCashFlow } from '@/lib/investments/investmentTransactions';

describe('deriveCashFlow', () => {
  it('maps a contribution/deposit to a confirmed positive (into-account) flow, negating Plaid sign', () => {
    // Plaid: contribution is cash credited to the account → negative Plaid amount.
    expect(deriveCashFlow({ type: 'cash', subtype: 'contribution', amount: -500 }))
      .toEqual({ kind: 'contribution', amount: 500, confirmed: true });
    expect(deriveCashFlow({ type: 'cash', subtype: 'deposit', amount: -250 }))
      .toEqual({ kind: 'contribution', amount: 250, confirmed: true });
  });

  it('maps a withdrawal/distribution to a confirmed negative (out-of-account) flow', () => {
    expect(deriveCashFlow({ type: 'cash', subtype: 'withdrawal', amount: 300 }))
      .toEqual({ kind: 'withdrawal', amount: -300, confirmed: true });
    expect(deriveCashFlow({ type: 'cash', subtype: 'distribution', amount: 1000 }))
      .toEqual({ kind: 'withdrawal', amount: -1000, confirmed: true });
  });

  it('maps an ambiguous transfer to an unconfirmed flow, direction by sign', () => {
    expect(deriveCashFlow({ type: 'transfer', subtype: null, amount: -400 }))
      .toEqual({ kind: 'transfer_in', amount: 400, confirmed: false });
    expect(deriveCashFlow({ type: 'transfer', subtype: 'transfer', amount: 400 }))
      .toEqual({ kind: 'transfer_out', amount: -400, confirmed: false });
  });

  it('skips buys, sells, dividends, interest, fees, and anything unrecognized', () => {
    expect(deriveCashFlow({ type: 'buy', subtype: 'buy', amount: 1000 })).toBeNull();
    expect(deriveCashFlow({ type: 'sell', subtype: 'sell', amount: -1000 })).toBeNull();
    expect(deriveCashFlow({ type: 'cash', subtype: 'dividend', amount: -12 })).toBeNull();
    expect(deriveCashFlow({ type: 'cash', subtype: 'interest', amount: -3 })).toBeNull();
    expect(deriveCashFlow({ type: 'fee', subtype: 'management fee', amount: 8 })).toBeNull();
    expect(deriveCashFlow({ type: 'cancel', subtype: null, amount: 0 })).toBeNull();
  });

  it('drops internal realizedGainLoss legs even when subtyped deposit/withdrawal', () => {
    // In-plan fund rebalances emit realized gain/loss cash legs that Plaid tags as
    // deposit/withdrawal but move no external cash — they must not become flows.
    expect(deriveCashFlow({ type: 'cash', subtype: 'deposit', amount: -21695.9, name: 'VANG VALUE IDX ADM - realizedGainLoss' })).toBeNull();
    expect(deriveCashFlow({ type: 'cash', subtype: 'withdrawal', amount: 9887.99, name: 'VANG SMCPVL IDX ADM - realizedGainLoss' })).toBeNull();
  });

  it('drops zero-amount transactions (no cash moved)', () => {
    expect(deriveCashFlow({ type: 'cash', subtype: 'withdrawal', amount: 0, name: 'FID 500 INDEX - transferOut' })).toBeNull();
  });

  it('still maps a real per-fund contribution carrying a name', () => {
    expect(deriveCashFlow({ type: 'cash', subtype: 'contribution', amount: -1485, name: 'FID 500 INDEX - contribution' }))
      .toEqual({ kind: 'contribution', amount: 1485, confirmed: true });
  });
});

import { syncInvestmentTransactions } from '@/lib/investments/investmentTransactions';
import { encryptToken } from '@/lib/crypto';

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');

// A fake Plaid client whose investmentsTransactionsGet honors offset/count over a
// fixed list, so pagination is exercised. `securities` echoes each txn's security.
function fakeClient(txns: any[], securities: any[] = [], opts: { throws?: boolean } = {}) {
  return {
    investmentsTransactionsGet: async ({ options }: any) => {
      if (opts.throws) throw new Error('plaid down');
      const offset = options?.offset ?? 0;
      const count = options?.count ?? 500;
      return {
        data: {
          investment_transactions: txns.slice(offset, offset + count),
          securities,
          total_investment_transactions: txns.length,
        },
      };
    },
  } as any;
}

const ITEM = { id: 'item1', accessToken: encryptToken('access-token') };

describe('syncInvestmentTransactions', () => {
  it('stores raw txns and derives only external cash flows, negating Plaid sign', async () => {
    const { db } = makeTmpDb();
    seedAccount(db, 'acc1');
    const txns = [
      { investment_transaction_id: 'p1', account_id: 'pa-acc1', security_id: null, date: '2026-07-15', name: 'CONTRIB', amount: -500, quantity: null, price: null, fees: null, type: 'cash', subtype: 'contribution' },
      { investment_transaction_id: 'p2', account_id: 'pa-acc1', security_id: 's1', date: '2026-07-16', name: 'BUY VB', amount: 500, quantity: 5, price: 100, fees: null, type: 'buy', subtype: 'buy' },
    ];
    const securities = [{ security_id: 's1', ticker_symbol: 'VB', name: 'Vanguard Small Cap', type: 'etf' }];

    const res = await syncInvestmentTransactions(ITEM, { client: fakeClient(txns, securities) }, db);
    expect(res).toEqual({ transactions: 2, flows: 1 });

    const raw = db.select().from(schema.investmentTransactions).all();
    expect(raw.map((r) => r.plaidInvestmentTxnId).sort()).toEqual(['p1', 'p2']);
    const flows = db.select().from(schema.cashFlows).all();
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ amount: 500, kind: 'contribution', source: 'plaid', confirmed: true, securityId: null });
    expect(flows[0].sourceRef).toBe(raw.find((r) => r.plaidInvestmentTxnId === 'p1')!.id);
  });

  it('stores raw txns but derives NO cash flow for a statement-covered account', async () => {
    const { db } = makeTmpDb();
    seedAccount(db, 'acc1');
    // A statement snapshot marks the account as statement-owned for flows.
    db.insert(schema.investmentSnapshots).values({
      id: 'snap1', accountId: 'acc1', asOf: '2026-06-30', month: '2026-06',
      source: 'statement', totalValue: 1000, holdingsComplete: false, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    const txns = [{ investment_transaction_id: 'p1', account_id: 'pa-acc1', security_id: null, date: '2026-07-15', name: 'CONTRIB', amount: -500, quantity: null, price: null, fees: null, type: 'cash', subtype: 'contribution' }];

    const res = await syncInvestmentTransactions(ITEM, { client: fakeClient(txns) }, db);
    expect(res.transactions).toBe(1);                    // raw txn still stored
    expect(res.flows).toBe(0);                           // but no derived cash flow
    expect(db.select().from(schema.investmentTransactions).all()).toHaveLength(1);
    expect(db.select().from(schema.cashFlows).all().filter((f) => f.source === 'plaid')).toHaveLength(0);
  });

  it('is idempotent (dedup by plaid id) and never duplicates a derived flow', async () => {
    const { db } = makeTmpDb();
    seedAccount(db, 'acc1');
    const txns = [{ investment_transaction_id: 'p1', account_id: 'pa-acc1', security_id: null, date: '2026-07-15', name: 'CONTRIB', amount: -500, quantity: null, price: null, fees: null, type: 'cash', subtype: 'contribution' }];
    await syncInvestmentTransactions(ITEM, { client: fakeClient(txns) }, db);
    await syncInvestmentTransactions(ITEM, { client: fakeClient(txns) }, db);
    expect(db.select().from(schema.investmentTransactions).all()).toHaveLength(1);
    expect(db.select().from(schema.cashFlows).all()).toHaveLength(1);
  });

  it('does not clobber a user-edited derived flow on re-sync', async () => {
    const { db } = makeTmpDb();
    seedAccount(db, 'acc1');
    const txns = [{ investment_transaction_id: 'p1', account_id: 'pa-acc1', security_id: null, date: '2026-07-15', name: 'CONTRIB', amount: -500, quantity: null, price: null, fees: null, type: 'cash', subtype: 'contribution' }];
    await syncInvestmentTransactions(ITEM, { client: fakeClient(txns) }, db);
    // Simulate a user edit: flip confirmed off.
    db.update(schema.cashFlows).set({ confirmed: false }).run();
    await syncInvestmentTransactions(ITEM, { client: fakeClient(txns) }, db);
    const flows = db.select().from(schema.cashFlows).all();
    expect(flows).toHaveLength(1);
    expect(flows[0].confirmed).toBe(false); // preserved
  });

  it('returns zeros and writes nothing when the Plaid client throws', async () => {
    const { db } = makeTmpDb();
    seedAccount(db, 'acc1');
    const res = await syncInvestmentTransactions(ITEM, { client: fakeClient([], [], { throws: true }) }, db);
    expect(res).toEqual({ transactions: 0, flows: 0 });
    expect(db.select().from(schema.investmentTransactions).all()).toHaveLength(0);
  });

  it('paginates across pages', async () => {
    const { db } = makeTmpDb();
    seedAccount(db, 'acc1');
    const txns = Array.from({ length: 3 }, (_, i) => ({ investment_transaction_id: `p${i}`, account_id: 'pa-acc1', security_id: null, date: '2026-07-15', name: 'BUY', amount: 1, quantity: null, price: null, fees: null, type: 'buy', subtype: 'buy' }));
    // count=2 → two pages (0-1, 2). fakeClient honors offset/count.
    const client = {
      investmentsTransactionsGet: async ({ options }: any) => ({
        data: { investment_transactions: txns.slice(options.offset, options.offset + 2), securities: [], total_investment_transactions: txns.length },
      }),
    } as any;
    const res = await syncInvestmentTransactions(ITEM, { client, pageSize: 2 } as any, db);
    expect(res.transactions).toBe(3);
    expect(db.select().from(schema.investmentTransactions).all()).toHaveLength(3);
  });
});
