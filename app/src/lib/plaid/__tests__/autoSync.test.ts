import { describe, it, expect, vi } from 'vitest';
import type { PlaidApi } from 'plaid';
import { makeTmpDb } from '@/test/tmpDb';
import { plaidItems } from '@/db/schema';
import { shouldSyncOnStartup, newestSyncedAt, runAutoSync } from '@/lib/plaid/autoSync';

const NOW = new Date('2026-08-10T12:00:00.000Z');

describe('shouldSyncOnStartup', () => {
  it('syncs when nothing has ever synced', () => {
    expect(shouldSyncOnStartup(null, NOW)).toBe(true);
  });
  it('skips when the last sync is under 24h old', () => {
    expect(shouldSyncOnStartup('2026-08-09T13:00:00.000Z', NOW)).toBe(false); // 23h
  });
  it('syncs when the last sync is over 24h old', () => {
    expect(shouldSyncOnStartup('2026-08-09T11:00:00.000Z', NOW)).toBe(true); // 25h
  });
  it('treats exactly 24h as due (boundary belongs to sync)', () => {
    expect(shouldSyncOnStartup('2026-08-09T12:00:00.000Z', NOW)).toBe(true);
  });
  it('honors a custom threshold', () => {
    expect(shouldSyncOnStartup('2026-08-10T10:00:00.000Z', NOW, 1)).toBe(true); // 2h > 1h
  });
});

function insertItem(db: ReturnType<typeof makeTmpDb>['db'], id: string, lastSyncedAt: string | null) {
  const now = '2026-07-01T00:00:00.000Z';
  db.insert(plaidItems).values({
    id, plaidItemId: `p-${id}`, institutionName: 'Chase', accessToken: 'x',
    status: 'healthy', lastSyncedAt, createdAt: now, modifiedAt: now,
  }).run();
}

describe('newestSyncedAt', () => {
  it('returns null when no item has synced', () => {
    const { db } = makeTmpDb();
    insertItem(db, 'a', null);
    expect(newestSyncedAt(db)).toBeNull();
  });
  it('returns the max lastSyncedAt across items', () => {
    const { db } = makeTmpDb();
    insertItem(db, 'a', '2026-08-01T00:00:00.000Z');
    insertItem(db, 'b', '2026-08-09T00:00:00.000Z');
    insertItem(db, 'c', null);
    expect(newestSyncedAt(db)).toBe('2026-08-09T00:00:00.000Z');
  });
  it('returns null on an empty table', () => {
    const { db } = makeTmpDb();
    expect(newestSyncedAt(db)).toBeNull();
  });
});

const baseDeps = () => ({
  isConfigured: () => true,
  // Stub — tests never call real Plaid methods on it; they inject syncInvestments spies instead.
  client: {} as unknown as PlaidApi,
  db: makeTmpDb().db,
  syncExpenses: vi.fn(async () => ({ items: 0, added: 0 })),
  syncInvestments: vi.fn(async () => ({ items: 0, snapshots: 0 })),
});

describe('runAutoSync', () => {
  it('no-ops when Plaid is not configured', async () => {
    const d = { ...baseDeps(), isConfigured: () => false };
    await runAutoSync(d);
    expect(d.syncExpenses).not.toHaveBeenCalled();
    expect(d.syncInvestments).not.toHaveBeenCalled();
  });

  it('runs expenses then investments, forwarding the api key', async () => {
    const order: string[] = [];
    const d = {
      ...baseDeps(),
      apiKey: 'sk-test',
      syncExpenses: vi.fn(async () => { order.push('exp'); return { items: 0, added: 0 }; }),
      syncInvestments: vi.fn(async () => { order.push('inv'); return { items: 0, snapshots: 0 }; }),
    };
    await runAutoSync(d);
    expect(order).toEqual(['exp', 'inv']);
    expect(d.syncInvestments).toHaveBeenCalledWith(d.db, expect.objectContaining({ apiKey: 'sk-test' }));
  });

  it('contains a throwing expense sync and still attempts investments', async () => {
    const d = {
      ...baseDeps(),
      syncExpenses: vi.fn(async () => { throw new Error('plaid down'); }),
    };
    await expect(runAutoSync(d)).resolves.toBeUndefined();  // never rejects
    expect(d.syncInvestments).toHaveBeenCalledTimes(1);
  });

  it('contains a throwing investment sync', async () => {
    const d = {
      ...baseDeps(),
      syncInvestments: vi.fn(async () => { throw new Error('classify down'); }),
    };
    await expect(runAutoSync(d)).resolves.toBeUndefined();
  });

  it('contains a throw from resolving the default client when Plaid is unconfigured', async () => {
    // isConfigured is stubbed true but no `client` dep is injected, so runAutoSync
    // falls through to getPlaidClient() — which throws when Plaid env vars are
    // absent. That resolution now lives inside the outer try, so this must still
    // resolve rather than reject. Clear the Plaid env for the duration so the
    // throw is genuinely exercised regardless of the ambient test env.
    const savedEnv = { ...process.env };
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_SECRET;
    delete process.env.PLAID_SECRET_SANDBOX;
    delete process.env.PLAID_SECRET_PRODUCTION;
    try {
      const syncExpenses = vi.fn(async () => ({ items: 0, added: 0 }));
      const syncInvestments = vi.fn(async () => ({ items: 0, snapshots: 0 }));
      await expect(runAutoSync({
        isConfigured: () => true,
        syncExpenses,
        syncInvestments,
      })).resolves.toBeUndefined();
      // getPlaidClient() threw before either sync fn could run.
      expect(syncExpenses).not.toHaveBeenCalled();
      expect(syncInvestments).not.toHaveBeenCalled();
    } finally {
      process.env = savedEnv;
    }
  });

  it('serializes overlapping runs (mutex): a second call joins the first', async () => {
    let resolveExp: () => void;
    const gate = new Promise<void>((r) => { resolveExp = r; });
    const d = {
      ...baseDeps(),
      syncExpenses: vi.fn(async () => { await gate; return { items: 0, added: 0 }; }),
    };
    const first = runAutoSync(d);
    const second = runAutoSync(d);   // lands while first is still awaiting the gate
    resolveExp!();
    await Promise.all([first, second]);
    expect(d.syncExpenses).toHaveBeenCalledTimes(1);
    expect(d.syncInvestments).toHaveBeenCalledTimes(1);
  });
});
