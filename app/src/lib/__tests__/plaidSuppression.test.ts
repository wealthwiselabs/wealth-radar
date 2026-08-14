// app/src/lib/__tests__/plaidSuppression.test.ts
import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';
import type { AccountRow } from '@/lib/accounts';
import {
  suppressPlaidAccount,
  listSuppressedPlaidAccountIds,
  unsuppressPlaidAccount,
} from '@/lib/plaidSuppression';

const NOW = '2026-08-11T00:00:00.000Z';

function acct(over: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'a1', name: 'Brokerage', institution: 'Morgan Stanley', mask: '3100', owner: 'Alex',
    nameSource: 'derived', accountClass: 'investment', purpose: 'portfolio', type: 'investment',
    subtype: null, origin: 'plaid', plaidItemId: 'it1', plaidAccountId: 'pa-1',
    closedAtMonth: null, status: 'active', createdAt: NOW, modifiedAt: NOW, ...over,
  };
}

describe('plaidSuppression', () => {
  it('records a plaid account and lists it as suppressed', () => {
    const { db } = makeTmpDb();
    suppressPlaidAccount(acct(), db);
    expect(listSuppressedPlaidAccountIds(db).has('pa-1')).toBe(true);
    const row = db.select().from(schema.suppressedPlaidAccounts).get()!;
    expect(row).toMatchObject({ plaidAccountId: 'pa-1', plaidItemId: 'it1', institution: 'Morgan Stanley', name: 'Brokerage', mask: '3100' });
  });

  it('is a no-op for a manual account with no plaidAccountId', () => {
    const { db } = makeTmpDb();
    suppressPlaidAccount(acct({ plaidAccountId: null, origin: 'manual' }), db);
    expect(db.select().from(schema.suppressedPlaidAccounts).all()).toHaveLength(0);
  });

  it('is idempotent — suppressing the same account twice keeps one row', () => {
    const { db } = makeTmpDb();
    suppressPlaidAccount(acct(), db);
    suppressPlaidAccount(acct({ name: 'Renamed since' }), db);
    expect(db.select().from(schema.suppressedPlaidAccounts).all()).toHaveLength(1);
  });

  it('unsuppress lifts the record so the account can sync again', () => {
    const { db } = makeTmpDb();
    suppressPlaidAccount(acct(), db);
    expect(unsuppressPlaidAccount('pa-1', db)).toEqual({ restored: true });
    expect(listSuppressedPlaidAccountIds(db).has('pa-1')).toBe(false);
    expect(unsuppressPlaidAccount('pa-1', db)).toEqual({ restored: false });
  });
});
