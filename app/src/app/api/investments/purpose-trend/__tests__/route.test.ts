import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { GET } from '../route';

const NOW = '2026-08-10T00:00:00.000Z';
const req = (qs: string) => new Request(`http://t/api/investments/purpose-trend?${qs}`) as never;

function seedReserve() {
  db.insert(schema.accounts).values({
    id: 'a1', name: 'Brokerage', institution: 'Vanguard', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'reserve',
    owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
  db.insert(schema.securities).values({
    id: 'vusxx', ticker: 'VUSXX', name: 'VUSXX', kind: 'mutual_fund', assetType: 'money_market',
    tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
  }).run();
  for (const [id, asOf, v] of [['s1', '2026-01-31', 1000], ['s2', '2026-02-28', 1010]] as const) {
    db.insert(schema.investmentSnapshots).values({
      id, accountId: 'a1', asOf, month: asOf.slice(0, 7), source: 'statement',
      totalValue: v, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.snapshotHoldings).values({
      id: `${id}-h`, snapshotId: id, securityId: 'vusxx', quantity: null, value: v,
    }).run();
  }
}

function seedPortfolioAndReserve() {
  // Reserve account
  db.insert(schema.accounts).values({
    id: 'a_reserve', name: 'Reserve MM', institution: 'Vanguard', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'reserve',
    owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
  // Portfolio account
  db.insert(schema.accounts).values({
    id: 'a_portfolio', name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
  // Securities
  db.insert(schema.securities).values({
    id: 'vusxx2', ticker: 'VUSXX2', name: 'VUSXX Reserve', kind: 'mutual_fund', assetType: 'money_market',
    tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
  }).run();
  db.insert(schema.securities).values({
    id: 'fxaix2', ticker: 'FXAIX2', name: 'Fidelity US Index', kind: 'mutual_fund', assetType: 'us_equity',
    tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
  }).run();

  // Reserve snapshots
  for (const [id, asOf, v] of [['rs1', '2026-01-31', 2000], ['rs2', '2026-02-28', 2050]] as const) {
    db.insert(schema.investmentSnapshots).values({
      id, accountId: 'a_reserve', asOf, month: asOf.slice(0, 7), source: 'statement',
      totalValue: v, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.snapshotHoldings).values({
      id: `${id}-h`, snapshotId: id, securityId: 'vusxx2', quantity: null, value: v,
    }).run();
  }

  // Portfolio snapshots
  for (const [id, asOf, v] of [['ps1', '2026-01-31', 5000], ['ps2', '2026-02-28', 5200]] as const) {
    db.insert(schema.investmentSnapshots).values({
      id, accountId: 'a_portfolio', asOf, month: asOf.slice(0, 7), source: 'statement',
      totalValue: v, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.snapshotHoldings).values({
      id: `${id}-h`, snapshotId: id, securityId: 'fxaix2', quantity: null, value: v,
    }).run();
  }
}

function seedReserveTwoAccountsStaggeredStart() {
  // Account a1 has history from the window start onward — root-eligible.
  db.insert(schema.accounts).values({
    id: 'a1', name: 'Brokerage', institution: 'Vanguard', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'reserve',
    owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
  // Account b1's first (and only) snapshot postdates the window start — it
  // never brackets the window (no on/before-start snapshot), so it is
  // neither root-eligible NOR "missing" per accountsMissingIn's before&&after
  // rule, yet it DID report during the window. This is the exact shape
  // Finding 1 exists to disclose: silently dropped from endValue with no
  // accountsMissing signal.
  db.insert(schema.accounts).values({
    id: 'b1', name: 'MM Fund', institution: 'Ally', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'reserve',
    owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
  }).run();
  db.insert(schema.securities).values({
    id: 'vusxx', ticker: 'VUSXX', name: 'VUSXX', kind: 'mutual_fund', assetType: 'money_market',
    tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
  }).run();
  for (const [id, accountId, asOf, v] of [
    ['s1', 'a1', '2026-01-31', 1000],
    ['s2', 'a1', '2026-02-28', 1010],
    ['s3', 'b1', '2026-02-15', 500],
  ] as const) {
    db.insert(schema.investmentSnapshots).values({
      id, accountId, asOf, month: asOf.slice(0, 7), source: 'statement',
      totalValue: v, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    db.insert(schema.snapshotHoldings).values({
      id: `${id}-h`, snapshotId: id, securityId: 'vusxx', quantity: null, value: v,
    }).run();
  }
}

describe('purpose-trend route', () => {
  // Each test's assertion depends on exactly its own seed being present — e.g.
  // test 1's `overall.endValue` toBe(1010) only holds if test 3's accounts
  // haven't also been inserted into this shared db. Reset before every test,
  // same as the sibling security-purpose route test file.
  beforeEach(() => {
    db.delete(schema.snapshotHoldings).run();
    db.delete(schema.investmentSnapshots).run();
    db.delete(schema.securities).run();
    db.delete(schema.accounts).run();
  });

  it('returns monthly points and an overall figure for the window', async () => {
    seedReserve();
    const res = await GET(req('purposes=reserve&basis=monthly&from=2026-01-31&to=2026-02-28'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const feb = body.points.find((p: { periodKey: string }) => p.periodKey === 'monthly:2026-02');
    expect(feb.gain).toBeCloseTo(10, 2);
    expect(feb.roi).toBeCloseTo(0.01, 4);
    expect(body.overall.endValue).toBe(1010);
    expect(body.overall.gain).toBeCloseTo(10, 2);
  });

  it('rejects an unknown purpose', async () => {
    const res = await GET(req('purposes=retirement'));
    expect(res.status).toBe(400);
  });

  it('defaults to portfolio when no purposes are given', async () => {
    seedPortfolioAndReserve();
    const res = await GET(req('basis=monthly&from=2026-01-31&to=2026-02-28'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // When no purposes param is given, defaults to portfolio.
    // Portfolio account has non-null values; reserve account should be excluded.
    const portfolioHasData = body.points.some((p: { value: number | null }) => p.value !== null);
    expect(portfolioHasData).toBe(true);
    // Verify that we actually included portfolio (non-null) and excluded reserve:
    // the overall should reflect portfolio balance (5000→5200), not reserve (2000→2050)
    expect(body.overall.endValue).toBe(5200);
    expect(body.overall.gain).toBeCloseTo(200, 2);
  });

  it('exposes accountsInWindow alongside accountsCounted, so a caller can tell a root-excluded account (in window but not bracketing it) from one genuinely absent', async () => {
    seedReserveTwoAccountsStaggeredStart();
    const res = await GET(req('purposes=reserve&basis=monthly&from=2026-01-31&to=2026-02-28'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // b1 reported (2026-02-15) inside the window but has no on/before-start
    // snapshot, so it's excluded from the root sum (accountsCounted stays at
    // just a1) without ever bracketing the window (accountsMissing stays
    // empty) — accountsInWindow is the only field that catches it.
    expect(body.overall.accountsMissing).toEqual([]);
    expect(body.overall.accountsCounted).toBe(1);
    expect(body.overall.accountsInWindow).toBe(2);
    expect(body.overall.accountsCounted).toBeLessThan(body.overall.accountsInWindow);
  });

  describe('under a This-Year window that extends into the future', () => {
    // Fixed "today" so month arithmetic is assertable, same mechanism as
    // src/lib/__tests__/timeRange.test.ts (vi.useFakeTimers + setSystemTime).
    // The route computes `today` via `new Date().toISOString().slice(0, 10)`,
    // so freezing the system clock pins it without inventing a new seam.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('includes the current month and every month before it, and excludes every month after it', async () => {
      seedReserve(); // snapshots at 2026-01-31 and 2026-02-28; irrelevant to which
      // periods are enumerated — enumerateAllocationPeriods emits a calendar
      // period for every month in [from, to] regardless of snapshot data.
      const res = await GET(req('purposes=reserve&basis=monthly&from=2026-01-01&to=2026-12-31'));
      expect(res.status).toBe(200);
      const body = await res.json();
      const keys = body.points.map((p: { periodKey: string }) => p.periodKey);

      // Current month must survive. This is the assertion that separates the
      // correct fix (filter on period.startDate <= today) from the tempting
      // wrong one (clamp `to` to today): August's period ends 2026-08-31,
      // which is after today, so clamping `to` would drop August too.
      expect(keys).toContain('monthly:2026-08');

      // Every month before August also survives.
      for (const m of ['01', '02', '03', '04', '05', '06', '07']) {
        expect(keys).toContain(`monthly:2026-${m}`);
      }

      // No month after August (the period hasn't started yet).
      for (const m of ['09', '10', '11', '12']) {
        expect(keys).not.toContain(`monthly:2026-${m}`);
      }
    });
  });
});
