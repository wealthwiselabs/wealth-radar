import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { makeTmpDb } from '@/test/tmpDb';
import { plaidItems, transactions, monthlyAggregates, accounts as accountsTable, suppressedPlaidAccounts } from '@/db/schema';
import { encryptToken } from '@/lib/crypto';
import { syncItem, syncAllItems } from '@/lib/plaid/sync';
import { getAccountByPlaidId } from '@/lib/accounts';
import { suppressPlaidAccount } from '@/lib/plaidSuppression';
import { deleteAccountData } from '@/lib/accountRemoval';
import { transactionFingerprint } from '@/lib/fingerprint';
import { and, eq } from 'drizzle-orm';

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');

type Db = ReturnType<typeof makeTmpDb>['db'];

function insertItem(db: Db, over: Partial<typeof plaidItems.$inferInsert> = {}) {
  const now = '2026-07-12T00:00:00.000Z';
  db.insert(plaidItems).values({
    id: 'it1', plaidItemId: 'plaid-item-1', institutionName: 'Chase',
    accessToken: encryptToken('access-sandbox-x'), status: 'healthy',
    createdAt: now, modifiedAt: now, ...over,
  }).run();
}

const getItem = (db: Db, id: string) => db.select().from(plaidItems).where(eq(plaidItems.id, id)).get()!;

const acctsGet = () => vi.fn().mockResolvedValue({ data: {
  accounts: [{ account_id: 'acc-1', name: 'Sapphire', official_name: null, mask: '3118', type: 'credit', subtype: 'credit card', balances: {} }],
  item: { institution_id: 'ins_1' },
} });

// classify one result per input item.
const fakeClassify = vi.fn(async (input: unknown[]) => input.map(() => ({ categoryId: 'food', subcategoryId: 'coffee' }))) as any;

describe('syncItem', () => {
  it('ingests added Plaid transactions with flipped sign and advances the cursor', async () => {
    const { db } = makeTmpDb();
    insertItem(db);
    const fakeClient = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [{ transaction_id: 'tx-1', account_id: 'acc-1', date: '2026-06-15', name: 'STARBUCKS', amount: 4.5, pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK' } }],
        modified: [], removed: [], next_cursor: 'cursor-2', has_more: false,
      } }),
    };
    const res = await syncItem(getItem(db, 'it1'), { client: fakeClient as any, classify: fakeClassify }, db);
    expect(res.added).toBe(1);
    const rows = db.select().from(transactions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].externalId).toBe('tx-1');
    expect(rows[0].amount).toBe(-4.5);           // Plaid +4.5 (money out) → expense -4.5
    expect(rows[0].source).toBe('plaid');
    const item = getItem(db, 'it1');
    expect(item.cursor).toBe('cursor-2');
    expect(item.status).toBe('healthy');
  });

  it('updates a modified transaction in place (pending→posted, amount fix) without duplicating', async () => {
    const { db } = makeTmpDb();
    insertItem(db);

    // First sync: a pending charge, Plaid +10 → stored -10.
    const client1 = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [{ transaction_id: 'tx-9', account_id: 'acc-1', date: '2026-06-15', name: 'STARBUCKS', amount: 10, pending: true, personal_finance_category: { primary: 'FOOD_AND_DRINK' } }],
        modified: [], removed: [], next_cursor: 'c1', has_more: false,
      } }),
    };
    await syncItem(getItem(db, 'it1'), { client: client1 as any, classify: fakeClassify }, db);
    const before = db.select().from(transactions).where(eq(transactions.externalId, 'tx-9')).get()!;
    expect(before.pending).toBe(true);
    expect(before.amount).toBe(-10);

    // Manually re-categorize to prove the update preserves categoryId/subcategoryId.
    db.update(transactions).set({ categoryId: 'dining', subcategoryId: 'restaurants' })
      .where(eq(transactions.id, before.id)).run();

    // Second sync: same txn returns as MODIFIED — posted, corrected amount 10.5.
    const client2 = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [], removed: [], next_cursor: 'c2', has_more: false,
        modified: [{ transaction_id: 'tx-9', account_id: 'acc-1', date: '2026-06-15', name: 'STARBUCKS COFFEE', amount: 10.5, pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK' } }],
      } }),
    };
    await syncItem(getItem(db, 'it1'), { client: client2 as any, classify: fakeClassify }, db);

    const after = db.select().from(transactions).where(eq(transactions.externalId, 'tx-9')).all();
    expect(after).toHaveLength(1);                 // updated, not duplicated
    expect(after[0].pending).toBe(false);
    expect(after[0].amount).toBe(-10.5);
    expect(after[0].description).toBe('STARBUCKS COFFEE');
    expect(after[0].categoryId).toBe('dining');    // manual edit preserved
    expect(after[0].subcategoryId).toBe('restaurants');
  });

  it('recomputes the fingerprint of a modified-in-place transaction', async () => {
    const { db } = makeTmpDb();
    insertItem(db);

    const client1 = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [{ transaction_id: 'tx-9', account_id: 'acc-1', date: '2026-06-15', name: 'STARBUCKS', amount: 10, pending: true, personal_finance_category: { primary: 'FOOD_AND_DRINK' } }],
        modified: [], removed: [], next_cursor: 'c1', has_more: false,
      } }),
    };
    await syncItem(getItem(db, 'it1'), { client: client1 as any, classify: fakeClassify }, db);
    const account = (await getAccountByPlaidId('acc-1', db))!;
    const beforeFp = db.select().from(transactions).where(eq(transactions.externalId, 'tx-9')).get()!.fingerprint;

    // Modify: new name + corrected amount → fingerprint inputs change.
    const client2 = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [], removed: [], next_cursor: 'c2', has_more: false,
        modified: [{ transaction_id: 'tx-9', account_id: 'acc-1', date: '2026-06-15', name: 'STARBUCKS COFFEE', amount: 10.5, pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK' } }],
      } }),
    };
    await syncItem(getItem(db, 'it1'), { client: client2 as any, classify: fakeClassify }, db);

    const row = db.select().from(transactions).where(eq(transactions.externalId, 'tx-9')).get()!;
    const expectedFp = transactionFingerprint({ accountId: account.id, date: '2026-06-15', description: 'STARBUCKS COFFEE', amount: -10.5 });
    expect(row.fingerprint).toBe(expectedFp);      // recomputed from the NEW values
    expect(row.fingerprint).not.toBe(beforeFp);    // and it changed
  });

  it('recomputes aggregates when a transaction is removed', async () => {
    const { db } = makeTmpDb();
    insertItem(db);

    const client1 = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [{ transaction_id: 'tx-r', account_id: 'acc-1', date: '2026-06-15', name: 'STARBUCKS', amount: 4.5, pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK' } }],
        modified: [], removed: [], next_cursor: 'c1', has_more: false,
      } }),
    };
    await syncItem(getItem(db, 'it1'), { client: client1 as any, classify: fakeClassify }, db);
    const account = (await getAccountByPlaidId('acc-1', db))!;
    const aggBefore = db.select().from(monthlyAggregates)
      .where(and(eq(monthlyAggregates.accountId, account.id), eq(monthlyAggregates.month, '2026-06'), eq(monthlyAggregates.categoryId, 'food'))).get();
    expect(aggBefore?.expenseTotal).toBe(4.5);
    expect(aggBefore?.txnCount).toBe(1);

    const client2 = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [], modified: [], next_cursor: 'c2', has_more: false,
        removed: [{ transaction_id: 'tx-r', account_id: 'acc-1' }],
      } }),
    };
    await syncItem(getItem(db, 'it1'), { client: client2 as any, classify: fakeClassify }, db);

    expect(db.select().from(transactions).all()).toHaveLength(0);
    const aggAfter = db.select().from(monthlyAggregates)
      .where(and(eq(monthlyAggregates.accountId, account.id), eq(monthlyAggregates.month, '2026-06'))).all();
    expect(aggAfter).toHaveLength(0);              // derived rows rebuilt from zero remaining txns
  });

  it('records a non-null syncedThroughMonth even when every returned transaction already exists (added: 0)', async () => {
    const { db } = makeTmpDb();
    insertItem(db);

    // First sync: ingest tx-9 so it already exists in the DB.
    const client1 = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [{ transaction_id: 'tx-9', account_id: 'acc-1', date: '2026-06-15', name: 'STARBUCKS', amount: 10, pending: true, personal_finance_category: { primary: 'FOOD_AND_DRINK' } }],
        modified: [], removed: [], next_cursor: 'c1', has_more: false,
      } }),
    };
    await syncItem(getItem(db, 'it1'), { client: client1 as any, classify: fakeClassify }, db);
    expect(getItem(db, 'it1').syncedThroughMonth).not.toBeNull();

    // Simulate the merge scenario: clear the mark to null, as if this item had
    // never recorded a sync (e.g. a PDF-merged account whose history was already
    // present the first time Plaid connected). The next sync reports tx-9 as
    // MODIFIED (pending→posted) — it matches the existing row and is updated
    // in place, so it never enters `toInsert` and nothing is inserted.
    db.update(plaidItems).set({ syncedThroughMonth: null }).where(eq(plaidItems.id, 'it1')).run();

    const client2 = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [], removed: [], next_cursor: 'c2', has_more: false,
        modified: [{ transaction_id: 'tx-9', account_id: 'acc-1', date: '2026-06-15', name: 'STARBUCKS', amount: 10, pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK' } }],
      } }),
    };
    const res = await syncItem(getItem(db, 'it1'), { client: client2 as any, classify: fakeClassify }, db);
    expect(res.added).toBe(0);       // updated in place — nothing inserted
    expect(getItem(db, 'it1').status).toBe('healthy');

    // The bug: a successful sync that inserts nothing must NOT be recorded as
    // never having synced.
    expect(getItem(db, 'it1').syncedThroughMonth).not.toBeNull();
  });

  it('does not re-create a suppressed account, nor ingest its transactions', async () => {
    const { db } = makeTmpDb();
    insertItem(db);

    // First sync provisions acc-1 and ingests a transaction.
    const client1 = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [{ transaction_id: 'tx-1', account_id: 'acc-1', date: '2026-06-15', name: 'STARBUCKS', amount: 4.5, pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK' } }],
        modified: [], removed: [], next_cursor: 'c1', has_more: false,
      } }),
    };
    await syncItem(getItem(db, 'it1'), { client: client1 as any, classify: fakeClassify }, db);
    const created = (await getAccountByPlaidId('acc-1', db))!;
    expect(created).toBeTruthy();

    // The user removes the account: suppress its plaidAccountId, then hard-delete
    // the row and everything referencing it (the real per-account remove flow).
    suppressPlaidAccount(created, db);
    deleteAccountData(created.id, db);

    // Next sync returns acc-1 again (Item still connected) with a fresh transaction.
    const client2 = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [{ transaction_id: 'tx-2', account_id: 'acc-1', date: '2026-07-15', name: 'STARBUCKS', amount: 9, pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK' } }],
        modified: [], removed: [], next_cursor: 'c2', has_more: false,
      } }),
    };
    const res = await syncItem(getItem(db, 'it1'), { client: client2 as any, classify: fakeClassify }, db);

    // The account stays gone and none of its transactions are ingested.
    expect(await getAccountByPlaidId('acc-1', db)).toBeNull();
    expect(db.select().from(accountsTable).all()).toHaveLength(0);
    expect(db.select().from(transactions).all()).toHaveLength(0);
    expect(res.added).toBe(0);
    // The sync itself still completes cleanly.
    expect(getItem(db, 'it1').status).toBe('healthy');
    // The suppression record survives the sync.
    expect(db.select().from(suppressedPlaidAccounts).all().map((r) => r.plaidAccountId)).toEqual(['acc-1']);
  });

  it('records a non-null syncedThroughMonth on a successful sync that returns no transactions at all', async () => {
    const { db } = makeTmpDb();
    insertItem(db);

    const client = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [], modified: [], removed: [], next_cursor: 'c1', has_more: false,
      } }),
    };
    const res = await syncItem(getItem(db, 'it1'), { client: client as any, classify: fakeClassify }, db);
    expect(res.added).toBe(0);
    expect(getItem(db, 'it1').status).toBe('healthy');
    expect(getItem(db, 'it1').syncedThroughMonth).not.toBeNull();
  });
});

describe('syncAllItems pre-sync snapshot', () => {
  it('snapshots before mutating, so a transaction the sync deletes survives in the snapshot', async () => {
    const { db, file } = makeTmpDb();
    insertItem(db);

    // Sync 1: ingest tx-r.
    const client1 = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [{ transaction_id: 'tx-r', account_id: 'acc-1', date: '2026-06-15', name: 'STARBUCKS', amount: 4.5, pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK' } }],
        modified: [], removed: [], next_cursor: 'c1', has_more: false,
      } }),
    };
    await syncAllItems(db, { client: client1 as any, classify: fakeClassify });
    expect(db.select().from(transactions).all()).toHaveLength(1);

    // Sync 2: Plaid reports it removed — destructive.
    const client2 = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [], modified: [], next_cursor: 'c2', has_more: false,
        removed: [{ transaction_id: 'tx-r', account_id: 'acc-1' }],
      } }),
    };
    await syncAllItems(db, { client: client2 as any, classify: fakeClassify });
    expect(db.select().from(transactions).all()).toHaveLength(0);   // gone from live DB

    // The most recent snapshot must hold the pre-removal state.
    const dir = path.join(path.dirname(file), 'snapshots');
    const snaps = fs.readdirSync(dir).filter(f => f.startsWith('pre-sync-')).sort();
    expect(snaps.length).toBeGreaterThan(0);

    const latest = new Database(path.join(dir, snaps[snaps.length - 1]), { readonly: true });
    const rows = latest.prepare('SELECT external_id FROM transactions').all() as { external_id: string }[];
    latest.close();
    expect(rows.map(r => r.external_id)).toContain('tx-r');
  });
});

describe('syncAllItems isolation', () => {
  it('a bad item does not abort the loop; the good item still syncs and the bad item is marked error', async () => {
    const { db } = makeTmpDb();
    // Item A: corrupt access token — decryptToken throws before any Plaid call.
    insertItem(db, { id: 'itA', plaidItemId: 'p-A', accessToken: 'not-valid-encrypted' });
    // Item B: valid token.
    insertItem(db, { id: 'itB', plaidItemId: 'p-B' });

    const client = {
      accountsGet: acctsGet(),
      transactionsSync: vi.fn().mockResolvedValue({ data: {
        added: [{ transaction_id: 'tx-b', account_id: 'acc-1', date: '2026-06-15', name: 'STARBUCKS', amount: 4.5, pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK' } }],
        modified: [], removed: [], next_cursor: 'cB', has_more: false,
      } }),
    };

    // Must not throw despite item A being broken.
    const res = await syncAllItems(db, { client: client as any, classify: fakeClassify });
    expect(res.items).toBe(2);
    expect(res.added).toBe(1);

    // Item B's transaction was ingested.
    const rows = db.select().from(transactions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].externalId).toBe('tx-b');

    // Item A is flipped to error; item B is healthy.
    expect(getItem(db, 'itA').status).toBe('error');
    expect(getItem(db, 'itB').status).toBe('healthy');
  });
});

describe('syncAllItems investment routing', () => {
  it('runs holdings sync only for items that own an investment account', async () => {
    const { db } = makeTmpDb();
    insertItem(db, { id: 'bank', plaidItemId: 'p-bank' });
    insertItem(db, { id: 'brk', plaidItemId: 'p-brk', institutionName: 'Fidelity' });
    const now = '2026-08-03T00:00:00.000Z';
    db.insert(accountsTable).values({
      id: 'inv1', name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
      type: 'investment', origin: 'plaid', plaidItemId: 'brk', plaidAccountId: 'pa-1',
      status: 'active', purpose: 'portfolio', owner: 'Alex', createdAt: now, modifiedAt: now,
    }).run();

    const emptyTxSync = { data: { added: [], modified: [], removed: [], next_cursor: 'c', has_more: false } };
    const client = { accountsGet: acctsGet(), transactionsSync: vi.fn().mockResolvedValue(emptyTxSync) };
    const spy = vi.fn().mockResolvedValue({ snapshots: 1, skipped: 0 });

    await syncAllItems(db, { client: client as any, classify: fakeClassify, syncInvestments: spy } as any);

    const calledItemIds = spy.mock.calls.map((c) => c[0].id);
    expect(calledItemIds).toContain('brk');
    expect(calledItemIds).not.toContain('bank');
  });
});
