import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { listInvestmentAccounts, loadPortfolioContext, listReserveFlows } from '@/lib/investments/read';
import { commitSnapshot } from '@/lib/investments/snapshots';
import { accounts, cashFlows } from '@/db/schema';

const NOW = '2026-08-03T00:00:00.000Z';

function seed(db: ReturnType<typeof makeTmpDb>['db'], id: string, over: Record<string, unknown> = {}) {
  db.insert(accounts).values({
    id, name: id, institution: 'Bank', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    createdAt: NOW, modifiedAt: NOW, ...over,
  }).run();
}

describe('listInvestmentAccounts', () => {
  it('excludes spending accounts', async () => {
    const { db } = makeTmpDb();
    seed(db, 'inv');
    seed(db, 'spend', { accountClass: 'spending', type: 'depository' });
    const rows = await listInvestmentAccounts('2026-08-03', db);
    expect(rows.map((r) => r.id)).toEqual(['inv']);
  });

  it('reports the latest snapshot value and flags stale accounts', async () => {
    const { db } = makeTmpDb();
    seed(db, 'fresh');
    seed(db, 'stale');
    seed(db, 'never');
    await commitSnapshot({ accountId: 'fresh', asOf: '2026-07-31', source: 'manual', totalValue: 100 }, db);
    await commitSnapshot({ accountId: 'stale', asOf: '2026-03-31', source: 'manual', totalValue: 50 }, db);

    const rows = await listInvestmentAccounts('2026-08-03', db);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('fresh')!.latestValue).toBe(100);
    expect(byId.get('fresh')!.stale).toBe(false);
    expect(byId.get('stale')!.stale).toBe(true);
    expect(byId.get('never')!.latestValue).toBeNull();
    expect(byId.get('never')!.stale).toBe(true);
  });
});

describe('loadPortfolioContext', () => {
  it('loads snapshots, purposes, and confirmed flows only', async () => {
    const { db } = makeTmpDb();
    seed(db, 'a1');
    seed(db, 'r1', { purpose: 'reserve' });
    await commitSnapshot({ accountId: 'a1', asOf: '2026-06-30', source: 'manual', totalValue: 10 }, db);
    db.insert(cashFlows).values([
      { id: 'f1', accountId: 'a1', date: '2026-06-15', amount: 5, kind: 'contribution', source: 'manual', confirmed: true, note: '', createdAt: NOW, modifiedAt: NOW },
      { id: 'f2', accountId: 'a1', date: '2026-06-20', amount: 9, kind: 'contribution', source: 'suggested', confirmed: false, note: '', createdAt: NOW, modifiedAt: NOW },
    ]).run();

    const ctx = await loadPortfolioContext(db);
    expect(ctx.snapshots).toHaveLength(1);
    expect(ctx.accountPurposes.get('r1')).toBe('reserve');
    expect(ctx.flows.map((f) => f.id)).toEqual(['f1']);
  });
});

describe('listReserveFlows', () => {
  it('returns confirmed flows for reserve accounts only, newest first', async () => {
    const { db } = makeTmpDb();
    db.insert(accounts).values([
      { id: 'res', name: 'Money Fund', institution: 'Vanguard', accountClass: 'investment',
        type: 'investment', origin: 'manual', status: 'active', purpose: 'reserve', createdAt: NOW, modifiedAt: NOW },
      { id: 'port', name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
        type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio', createdAt: NOW, modifiedAt: NOW },
    ]).run();
    db.insert(cashFlows).values([
      { id: 'a', accountId: 'res', date: '2026-06-01', amount: 1000, kind: 'contribution', source: 'manual', confirmed: true, note: 'top up', createdAt: NOW, modifiedAt: NOW },
      { id: 'b', accountId: 'res', date: '2026-07-01', amount: -200, kind: 'withdrawal', source: 'manual', confirmed: true, note: '', createdAt: NOW, modifiedAt: NOW },
      { id: 'c', accountId: 'res', date: '2026-07-15', amount: 50, kind: 'contribution', source: 'suggested', confirmed: false, note: '', createdAt: NOW, modifiedAt: NOW },
      { id: 'd', accountId: 'port', date: '2026-07-01', amount: 9999, kind: 'contribution', source: 'manual', confirmed: true, note: '', createdAt: NOW, modifiedAt: NOW },
    ]).run();

    const flows = await listReserveFlows('0000-01-01', '9999-12-31', db);
    expect(flows.map((f) => f.id)).toEqual(['b', 'a']);   // newest first, unconfirmed + portfolio excluded
    expect(flows[0].accountLabel).toBe('Vanguard · Money Fund');
  });
});

describe('listReserveFlows window', () => {
  it('returns only flows dated inside [from, to]', async () => {
    const { db } = makeTmpDb();
    const NOW = '2026-08-10T00:00:00.000Z';
    db.insert(accounts).values({
      id: 'r1', name: 'Brokerage', institution: 'Vanguard', accountClass: 'investment',
      type: 'investment', origin: 'manual', status: 'active', purpose: 'reserve',
      owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
    }).run();
    const flow = (id: string, date: string, amount: number) =>
      db.insert(cashFlows).values({
        id, accountId: 'r1', securityId: null, date, amount, kind: 'contribution',
        source: 'statement', confirmed: true, note: '', createdAt: NOW, modifiedAt: NOW,
      }).run();
    flow('f1', '2025-12-31', 100);
    flow('f2', '2026-02-15', 200);
    flow('f3', '2026-09-01', 300);

    const inWindow = await listReserveFlows('2026-01-01', '2026-08-10', db);
    expect(inWindow.map((f) => f.id)).toEqual(['f2']);

    const all = await listReserveFlows('2025-01-01', '2026-12-31', db);
    expect(all.map((f) => f.id).sort()).toEqual(['f1', 'f2', 'f3']);
  });
});
