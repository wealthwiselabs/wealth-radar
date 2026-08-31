import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { balanceSnapshots } from '@/db/schema';

// syncItem decrypts item.accessToken before doing anything else, so the fixture
// needs a real encrypted token (matching the convention in sync.test.ts) — a
// plain placeholder string always fails decryptToken's format check and routes
// straight to finishError before the account loop ever runs.
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { syncItem } from '@/lib/plaid/sync';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { staleAccounts } from '@/lib/netWorth/staleness';
import { encryptToken } from '@/lib/crypto';

const account = (over: Record<string, unknown>) => ({
  account_id: 'p1', name: 'Card', official_name: null, mask: '1234',
  type: 'credit', subtype: 'credit card',
  balances: { current: 8400, available: null, limit: null, iso_currency_code: 'USD' },
  ...over,
});

function client(accounts: unknown[]) {
  return {
    accountsGet: vi.fn(async () => ({ data: { accounts } })),
    transactionsSync: vi.fn(async () => ({
      data: { added: [], modified: [], removed: [], next_cursor: 'c1', has_more: false },
    })),
  };
}

const item = {
  id: 'item-1', accessToken: encryptToken('access-sandbox-x'), institutionName: 'Chase', owner: 'Alex',
  cursor: null, syncedThroughMonth: null,
} as never;

describe('sync writes balances', () => {
  it('records a positive magnitude for a credit card balance', async () => {
    await syncItem(item, { client: client([account({})]) } as never);
    const rows = db.select().from(balanceSnapshots).all();
    expect(rows).toHaveLength(1);
    // Plaid reports card and loan balances as positive amounts owed. We store a
    // magnitude and derive direction from netWorthSide, so Math.abs is required
    // rather than cosmetic.
    expect(rows[0].balance).toBe(8400);
    expect(rows[0].source).toBe('plaid');
  });

  it('falls back to available when current is null', async () => {
    const { db: db2 } = makeTmpDb();
    void db2;
    await syncItem(item, {
      client: client([account({ account_id: 'p2', balances: { current: null, available: 1200 } })]),
    } as never);
    const row = db.select().from(balanceSnapshots).all().find((r) => r.balance === 1200);
    expect(row).toBeDefined();
  });

  it('writes no row when both current and available are null', async () => {
    const before = db.select().from(balanceSnapshots).all().length;
    await syncItem(item, {
      client: client([account({ account_id: 'p3', balances: { current: null, available: null } })]),
    } as never);
    expect(db.select().from(balanceSnapshots).all().length).toBe(before);
  });

  it('skips investment accounts, which syncInvestments already values', async () => {
    const before = db.select().from(balanceSnapshots).all().length;
    await syncItem(item, {
      client: client([account({ account_id: 'p4', type: 'investment', subtype: 'brokerage' })]),
    } as never);
    expect(db.select().from(balanceSnapshots).all().length).toBe(before);
  });

  it('never lists a Plaid-fed account in staleAccounts, even with an old reading', async () => {
    await syncItem(item, {
      client: client([account({ account_id: 'p5', mask: '9999' })]),
    } as never);
    const ctx = await loadNetWorthContext(db);
    const acct = ctx.accounts.find((a) => a.plaidAccountId === 'p5')!;
    expect(acct.reviewIntervalMonths).toBeNull();
    // Force an old reading directly and confirm it still never nags.
    const stale = staleAccounts(ctx, '2030-01-01');
    expect(stale.find((s) => s.accountId === acct.id)).toBeUndefined();
  });
});
