import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { cashFlows, securities, accounts } from '@/db/schema';

describe('cash_flows.securityId', () => {
  it('stores a nullable securityId that reads back', () => {
    const { db } = makeTmpDb();
    const now = '2026-08-05T00:00:00.000Z';
    db.insert(accounts).values({
      id: 'a1', name: 'a1', institution: 'Bank', accountClass: 'investment',
      type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
      createdAt: now, modifiedAt: now,
    }).run();
    db.insert(securities).values({
      id: 'sec1', ticker: null, name: 'Legacy: Bond', kind: 'other', assetType: 'bond',
      tagSource: 'seed', createdAt: now, modifiedAt: now,
    }).run();
    db.insert(cashFlows).values([
      { id: 'f1', accountId: 'a1', securityId: 'sec1', date: '2025-01-01', amount: 100, kind: 'contribution', source: 'legacy', confirmed: true, note: '', createdAt: now, modifiedAt: now },
      { id: 'f2', accountId: 'a1', securityId: null, date: '2025-01-01', amount: 50, kind: 'contribution', source: 'manual', confirmed: true, note: '', createdAt: now, modifiedAt: now },
    ]).run();
    const rows = db.select().from(cashFlows).all().sort((a, b) => a.id.localeCompare(b.id));
    expect(rows[0].securityId).toBe('sec1');
    expect(rows[1].securityId).toBeNull();
  });
});
