import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import {
  commitSnapshot, listSnapshots, reconcile, monthOfDate, ReconciliationError,
} from '@/lib/investments/snapshots';
import { accounts, snapshotHoldings } from '@/db/schema';

/**
 * Pass-through mock with one escape hatch: the ticker `BOOM` resolves to a
 * security id that does not exist, so inserting that holding violates
 * `snapshot_holdings.security_id`'s foreign key. That is the cleanest way to
 * fail *inside* commitSnapshot's write transaction now that duplicate tickers
 * are aggregated and no longer trip the unique constraint. Every other ticker
 * takes the real code path.
 */
vi.mock('@/lib/investments/securities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/investments/securities')>();
  return {
    ...actual,
    resolveOrCreateSecurity: async (
      input: Parameters<typeof actual.resolveOrCreateSecurity>[0],
      db?: Parameters<typeof actual.resolveOrCreateSecurity>[1],
    ) => {
      if (input.ticker === 'BOOM') {
        return { id: 'no-such-security-row' } as Awaited<
          ReturnType<typeof actual.resolveOrCreateSecurity>
        >;
      }
      return actual.resolveOrCreateSecurity(input, db);
    },
  };
});

const NOW = '2026-08-03T00:00:00.000Z';

function seedAccount(db: ReturnType<typeof makeTmpDb>['db'], id = 'a1') {
  db.insert(accounts).values({
    id, name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('monthOfDate', () => {
  it('extracts YYYY-MM', () => {
    expect(monthOfDate('2026-07-31')).toBe('2026-07');
  });
});

describe('reconcile', () => {
  it('reports an exact match as within tolerance', () => {
    const r = reconcile(1000, [
      { ticker: 'VTI', name: 'VTI', quantity: 2, value: 600 },
      { ticker: 'VGT', name: 'VGT', quantity: 1, value: 400 },
    ]);
    expect(r.holdingsSum).toBe(1000);
    expect(r.delta).toBe(0);
    expect(r.withinTolerance).toBe(true);
  });

  it('tolerates rounding but not a real gap', () => {
    expect(reconcile(1000, [{ ticker: 'VTI', name: 'VTI', quantity: 1, value: 999.995 }]).withinTolerance).toBe(true);
    expect(reconcile(1000, [{ ticker: 'VTI', name: 'VTI', quantity: 1, value: 900 }]).withinTolerance).toBe(false);
  });

  it('treats an empty holdings list as no claim rather than a zero sum', () => {
    const r = reconcile(1000, []);
    expect(r.withinTolerance).toBe(true);
    expect(r.holdingsSum).toBe(0);
  });
});

describe('commitSnapshot', () => {
  it('stores holdings and marks the snapshot complete when they reconcile', async () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    const { snapshotId, reconciliation } = await commitSnapshot({
      accountId: 'a1', asOf: '2026-07-31', source: 'paste', totalValue: 1000,
      holdings: [
        { ticker: 'VTI', name: 'Vanguard Total Stock', quantity: 2, value: 600 },
        { ticker: 'VGT', name: 'Vanguard IT', quantity: 1, value: 400 },
      ],
    }, db);

    expect(reconciliation.withinTolerance).toBe(true);
    const rows = await listSnapshots('a1', db);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(snapshotId);
    expect(rows[0].month).toBe('2026-07');
    expect(rows[0].holdingsComplete).toBe(true);
    expect(rows[0].holdings).toHaveLength(2);
    expect(rows[0].holdings.reduce((s, h) => s + h.value, 0)).toBe(1000);
  });

  it('stores a total-only snapshot as incomplete', async () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    await commitSnapshot(
      { accountId: 'a1', asOf: '2026-07-31', source: 'manual', totalValue: 500 }, db);
    const rows = await listSnapshots('a1', db);
    expect(rows[0].holdingsComplete).toBe(false);
    expect(rows[0].holdings).toHaveLength(0);
  });

  it('refuses a mismatched snapshot unless the mismatch is acknowledged', async () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    const bad = {
      accountId: 'a1', asOf: '2026-07-31', source: 'paste', totalValue: 1000,
      holdings: [{ ticker: 'VTI', name: 'VTI', quantity: 1, value: 400 }],
    };
    await expect(commitSnapshot(bad, db)).rejects.toThrow(/reconcil/i);

    const ok = await commitSnapshot({ ...bad, acknowledgeMismatch: true }, db);
    expect(ok.reconciliation.withinTolerance).toBe(false);
    const rows = await listSnapshots('a1', db);
    expect(rows[0].holdingsComplete).toBe(false);
  });

  it('replaces an existing snapshot for the same account and date', async () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    await commitSnapshot({
      accountId: 'a1', asOf: '2026-07-31', source: 'paste', totalValue: 1000,
      holdings: [{ ticker: 'VTI', name: 'VTI', quantity: 2, value: 1000 }],
    }, db);
    await commitSnapshot({
      accountId: 'a1', asOf: '2026-07-31', source: 'paste', totalValue: 1200,
      holdings: [{ ticker: 'VTI', name: 'VTI', quantity: 2, value: 1200 }],
    }, db);

    const rows = await listSnapshots('a1', db);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalValue).toBe(1200);
    // The superseded snapshot's holdings must not survive as orphans.
    expect(db.select().from(snapshotHoldings).all()).toHaveLength(1);
  });

  it('merges two rows of the same instrument into one holding whose value sums', async () => {
    // Two tax lots, or a fund held on both the employee and employer sides of
    // a 401k. Same security row either way, and snapshot_holdings is
    // UNIQUE(snapshot_id, security_id).
    const { db } = makeTmpDb();
    seedAccount(db);
    await commitSnapshot({
      accountId: 'a1', asOf: '2026-07-31', source: 'paste', totalValue: 1000,
      holdings: [
        { ticker: 'VTI', name: 'Vanguard Total Stock', quantity: 2, value: 600 },
        { ticker: 'VTI', name: 'Vanguard Total Stock', quantity: 1, value: 400 },
      ],
    }, db);

    const rows = await listSnapshots('a1', db);
    expect(rows[0].holdings).toHaveLength(1);
    expect(rows[0].holdings[0].value).toBe(1000);
    expect(rows[0].holdings[0].quantity).toBe(3);
    expect(rows[0].holdingsComplete).toBe(true);
  });

  it('drops the merged quantity to null when either contributing row lacks one', async () => {
    // A share count covering only part of the position is a wrong number, and
    // a wrong number is worse than an honest absence.
    const { db } = makeTmpDb();
    seedAccount(db);
    await commitSnapshot({
      accountId: 'a1', asOf: '2026-07-31', source: 'paste', totalValue: 1000,
      holdings: [
        { ticker: 'VTI', name: 'Vanguard Total Stock', quantity: 2, value: 600 },
        { ticker: 'VTI', name: 'Vanguard Total Stock', quantity: null, value: 400 },
      ],
    }, db);

    const rows = await listSnapshots('a1', db);
    expect(rows[0].holdings).toHaveLength(1);
    expect(rows[0].holdings[0].value).toBe(1000);
    expect(rows[0].holdings[0].quantity).toBeNull();
  });

  it('leaves the prior snapshot intact when a re-commit fails mid-write', async () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    const first = await commitSnapshot({
      accountId: 'a1', asOf: '2026-07-31', source: 'paste', totalValue: 1000,
      holdings: [{ ticker: 'VTI', name: 'Vanguard Total Stock', quantity: 2, value: 1000 }],
    }, db);

    await expect(commitSnapshot({
      accountId: 'a1', asOf: '2026-07-31', source: 'paste', totalValue: 1200,
      holdings: [
        { ticker: 'VGT', name: 'Vanguard IT', quantity: 1, value: 700 },
        { ticker: 'BOOM', name: 'Explodes On Insert', quantity: 1, value: 500 },
      ],
    }, db)).rejects.toThrow();

    // The old snapshot must survive whole: same id, same total, same holdings,
    // and no half-written replacement left behind claiming to be complete.
    const rows = await listSnapshots('a1', db);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.snapshotId);
    expect(rows[0].totalValue).toBe(1000);
    expect(rows[0].holdingsComplete).toBe(true);
    expect(rows[0].holdings).toHaveLength(1);
    expect(rows[0].holdings[0].value).toBe(1000);
    expect(db.select().from(snapshotHoldings).all()).toHaveLength(1);
  });

  it('throws ReconciliationError for a mismatch and a plain error for anything else', async () => {
    const { db } = makeTmpDb();
    seedAccount(db);

    await expect(commitSnapshot({
      accountId: 'a1', asOf: '2026-07-31', source: 'paste', totalValue: 1000,
      holdings: [{ ticker: 'VTI', name: 'VTI', quantity: 1, value: 400 }],
    }, db)).rejects.toThrow(ReconciliationError);

    // A write failure is a server fault, not a user-fixable 409. The route
    // branches on this distinction, so the types must actually differ.
    const other = await commitSnapshot({
      accountId: 'a1', asOf: '2026-06-30', source: 'paste', totalValue: 500,
      holdings: [{ ticker: 'BOOM', name: 'Explodes On Insert', quantity: 1, value: 500 }],
    }, db).then(() => null, (e: unknown) => e);
    expect(other).toBeInstanceOf(Error);
    expect(other).not.toBeInstanceOf(ReconciliationError);
  });

  it('persists holdings across a commit even though nothing renders them', async () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    await commitSnapshot({
      accountId: 'a1', asOf: '2026-06-30', source: 'paste', totalValue: 300,
      holdings: [{ ticker: null, name: 'Stable Value Fund', quantity: null, value: 300 }],
    }, db);
    const rows = await listSnapshots('a1', db);
    expect(rows[0].holdings).toHaveLength(1);
    expect(rows[0].holdings[0].quantity).toBeNull();
    expect(rows[0].holdings[0].value).toBe(300);
  });
});
