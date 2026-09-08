import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { NextRequest } from 'next/server';
import { GET } from '../route';

const NOW = '2026-09-06T00:00:00.000Z';
// This route reads `request.nextUrl`, which only exists on a NextRequest.
const req = (qs: string) => new NextRequest(`http://t/api/investments/allocation?${qs}`);

/** One portfolio account reporting at the end of Q2 and again mid-Q3. */
function seedAcrossQuarterBoundary() {
  db.insert(schema.accounts).values({
    id: 'a1', name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
    type: 'investment', origin: 'plaid', status: 'active', purpose: 'portfolio',
    owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
  db.insert(schema.securities).values({
    id: 'fxaix', ticker: 'FXAIX', name: 'Fidelity 500 Index', kind: 'mutual_fund',
    assetType: 'us_equity', tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
  }).run();
  for (const [id, asOf, v] of [['s1', '2026-06-30', 100000], ['s2', '2026-09-06', 110000]] as const) {
    db.insert(schema.investmentSnapshots).values({
      id, accountId: 'a1', asOf, month: asOf.slice(0, 7), source: 'plaid',
      totalValue: v, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.snapshotHoldings).values({
      id: `${id}-h`, snapshotId: id, securityId: 'fxaix', quantity: null, value: v,
    }).run();
  }
}

describe('allocation route', () => {
  beforeEach(() => {
    db.delete(schema.snapshotHoldings).run();
    db.delete(schema.investmentSnapshots).run();
    db.delete(schema.securities).run();
    db.delete(schema.accounts).run();
    vi.useFakeTimers();
    // Mid-Q3: the quarter has started but is nowhere near ending.
    vi.setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('offers the quarter in progress, not just the last completed one', async () => {
    seedAcrossQuarterBoundary();
    const res = await GET(req('basis=quarterly'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const keys = body.periods.map((p: { key: string }) => p.key);
    // The route builds the period PICKER. Without the current quarter in it there
    // is no way to view it at all, and the page reads two months stale.
    expect(keys).toContain('quarterly:2026-Q3');
    expect(keys).not.toContain('quarterly:2026-Q4');   // hasn't started
  });

  it('defaults to the in-progress quarter once it has data', async () => {
    seedAcrossQuarterBoundary();
    const res = await GET(req('basis=quarterly'));
    const body = await res.json();
    expect(body.selected).toBe('quarterly:2026-Q3');
    expect(body.tree).not.toBeNull();
    // Closed on the latest snapshot rather than on a 2026-09-30 that has none.
    expect(body.tree.balance).toBeCloseTo(110000, 2);
  });

  it('serves the in-progress quarter when asked for it by key', async () => {
    seedAcrossQuarterBoundary();
    const res = await GET(req('basis=quarterly&period=quarterly:2026-Q3'));
    const body = await res.json();
    expect(body.selected).toBe('quarterly:2026-Q3');
    expect(body.tree.balance).toBeCloseTo(110000, 2);
  });

  it('offers the month in progress under a monthly basis', async () => {
    seedAcrossQuarterBoundary();
    const res = await GET(req('basis=monthly'));
    const body = await res.json();
    const keys = body.periods.map((p: { key: string }) => p.key);
    expect(keys).toContain('monthly:2026-09');
    expect(keys).not.toContain('monthly:2026-10');
  });
});
