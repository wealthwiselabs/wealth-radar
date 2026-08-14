import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, investmentSnapshots, snapshotHoldings, plaidItems, securities } from '@/db/schema';
import { encryptToken } from '@/lib/crypto';
import { syncInvestments } from '@/lib/plaid/syncInvestments';
import { eq } from 'drizzle-orm';

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
const NOW = '2026-08-03T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function seedItemAndAccount(db: Db) {
  db.insert(plaidItems).values({
    id: 'it1', plaidItemId: 'p-it-1', institutionName: 'Fidelity', owner: 'Alex',
    accessToken: encryptToken('access-x'), status: 'healthy', createdAt: NOW, modifiedAt: NOW,
  }).run();
  db.insert(accounts).values({
    id: 'a1', name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
    type: 'investment', subtype: 'brokerage', origin: 'plaid', plaidItemId: 'it1',
    plaidAccountId: 'plaid-acc-1', status: 'active', purpose: 'portfolio', owner: 'Alex',
    createdAt: NOW, modifiedAt: NOW,
  }).run();
}

const item = (db: Db) => db.select().from(plaidItems).where(eq(plaidItems.id, 'it1')).get()!;

function holdingsClient(overrides: Record<string, unknown> = {}) {
  return {
    investmentsHoldingsGet: vi.fn().mockResolvedValue({ data: {
      accounts: [{ account_id: 'plaid-acc-1', balances: { current: 1000 } }],
      holdings: [
        { account_id: 'plaid-acc-1', security_id: 's-vgt', quantity: 2, institution_value: 600 },
        { account_id: 'plaid-acc-1', security_id: 's-cash', quantity: 400, institution_value: 400 },
      ],
      securities: [
        { security_id: 's-vgt', ticker_symbol: 'VGT', name: 'Vanguard IT', type: 'etf' },
        { security_id: 's-cash', ticker_symbol: null, name: 'Cash', type: 'cash' },
      ],
      ...overrides
    } }),
    accountsGet: vi.fn().mockResolvedValue({ data: {
      accounts: [{ account_id: 'plaid-acc-1', balances: { current: 1000 } }],
    } }),
  };
}

describe('syncInvestments', () => {
  it('writes one snapshot per investment account with mapped holdings', async () => {
    const { db } = makeTmpDb();
    seedItemAndAccount(db);
    const res = await syncInvestments(item(db), { client: holdingsClient() as any }, db);
    expect(res.snapshots).toBe(1);

    const snap = db.select().from(investmentSnapshots).where(eq(investmentSnapshots.accountId, 'a1')).get()!;
    expect(snap.source).toBe('plaid');
    expect(snap.totalValue).toBe(1000);
    expect(snap.holdingsComplete).toBe(true);
    expect(db.select().from(snapshotHoldings).where(eq(snapshotHoldings.snapshotId, snap.id)).all()).toHaveLength(2);
  });

  it('persists the mapped kind/assetType/tagSource on the resolved securities', async () => {
    const { db } = makeTmpDb();
    seedItemAndAccount(db);
    await syncInvestments(item(db), { client: holdingsClient() as any }, db);

    const vgt = db.select().from(securities).where(eq(securities.ticker, 'VGT')).get()!;
    expect(vgt.kind).toBe('etf');
    expect(vgt.assetType).toBe('equity');
    expect(vgt.tagSource).toBe('plaid');

    const cash = db.select().from(securities).all().find((s) => s.name === 'Cash')!;
    expect(cash.assetType).toBe('cash');
    expect(cash.tagSource).toBe('plaid');
  });

  it('falls back to a value-only snapshot when holdings are unavailable', async () => {
    const { db } = makeTmpDb();
    seedItemAndAccount(db);
    const client = holdingsClient();
    client.investmentsHoldingsGet = vi.fn().mockRejectedValue({ response: { data: { error_code: 'PRODUCTS_NOT_SUPPORTED' } } });
    const res = await syncInvestments(item(db), { client: client as any }, db);
    expect(res.snapshots).toBe(1);
    const snap = db.select().from(investmentSnapshots).where(eq(investmentSnapshots.accountId, 'a1')).get()!;
    expect(snap.totalValue).toBe(1000);
    expect(snap.holdingsComplete).toBe(false);
  });

  it('does not fall back to value-only on a transient error, and preserves any prior snapshot', async () => {
    const { db } = makeTmpDb();
    seedItemAndAccount(db);
    const client = holdingsClient();
    client.investmentsHoldingsGet = vi.fn().mockRejectedValue({ response: { data: { error_code: 'INTERNAL_SERVER_ERROR' } } });
    const res = await syncInvestments(item(db), { client: client as any }, db);
    expect(res).toEqual({ snapshots: 0, skipped: 0 });
    expect(client.accountsGet).not.toHaveBeenCalled();
    const snap = db.select().from(investmentSnapshots).where(eq(investmentSnapshots.accountId, 'a1')).get();
    expect(snap).toBeUndefined();
  });

  it('does not fall back to value-only on a plain network error with no error_code', async () => {
    const { db } = makeTmpDb();
    seedItemAndAccount(db);
    const client = holdingsClient();
    client.investmentsHoldingsGet = vi.fn().mockRejectedValue(new Error('network timeout'));
    const res = await syncInvestments(item(db), { client: client as any }, db);
    expect(res).toEqual({ snapshots: 0, skipped: 0 });
    expect(client.accountsGet).not.toHaveBeenCalled();
    const snap = db.select().from(investmentSnapshots).where(eq(investmentSnapshots.accountId, 'a1')).get();
    expect(snap).toBeUndefined();
  });

  it('commits value-authoritative when holdings do not reconcile', async () => {
    const { db } = makeTmpDb();
    seedItemAndAccount(db);
    const client = holdingsClient();
    // account value 1000 but holdings only sum to 600 → mismatch
    client.investmentsHoldingsGet = vi.fn().mockResolvedValue({ data: {
      accounts: [{ account_id: 'plaid-acc-1', balances: { current: 1000 } }],
      holdings: [{ account_id: 'plaid-acc-1', security_id: 's-vgt', quantity: 2, institution_value: 600 }],
      securities: [{ security_id: 's-vgt', ticker_symbol: 'VGT', name: 'Vanguard IT', type: 'etf' }],
    } });
    const res = await syncInvestments(item(db), { client: client as any }, db);
    expect(res.snapshots).toBe(1);
    const snap = db.select().from(investmentSnapshots).where(eq(investmentSnapshots.accountId, 'a1')).get()!;
    expect(snap.totalValue).toBe(1000);
    expect(snap.holdingsComplete).toBe(false);
  });

  it('skips an account with no matching local row rather than throwing', async () => {
    const { db } = makeTmpDb();
    seedItemAndAccount(db);
    const client = holdingsClient();
    client.investmentsHoldingsGet = vi.fn().mockResolvedValue({ data: {
      accounts: [{ account_id: 'UNKNOWN', balances: { current: 5 } }],
      holdings: [], securities: [],
    } });
    const res = await syncInvestments(item(db), { client: client as any }, db);
    expect(res.snapshots).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it('resolves rather than throws when access token is corrupted', async () => {
    const { db } = makeTmpDb();
    db.insert(plaidItems).values({
      id: 'it2', plaidItemId: 'p-it-2', institutionName: 'Fidelity', owner: 'Alex',
      accessToken: 'not-a-valid-token',
      status: 'healthy', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(accounts).values({
      id: 'a2', name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
      type: 'investment', subtype: 'brokerage', origin: 'plaid', plaidItemId: 'it2',
      plaidAccountId: 'plaid-acc-2', status: 'active', purpose: 'portfolio', owner: 'Alex',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    const badItem = db.select().from(plaidItems).where(eq(plaidItems.id, 'it2')).get()!;
    const res = await syncInvestments(badItem, { client: holdingsClient() as any }, db);
    expect(res).toEqual({ snapshots: 0, skipped: 0 });
  });
});
