import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { importLegacyQuarters, LEGACY_CLASS_TAGS, type LegacyClassRow } from '@/lib/investments/legacyImport';
import { listSnapshots } from '@/lib/investments/snapshots';
import { purposeReturnBetween } from '@/lib/investments/series';
import { accounts, cashFlows, securities } from '@/db/schema';
import type { Purpose } from '@/lib/investments/purpose';

const NOW = '2026-08-03T00:00:00.000Z';

function seedAccount(db: ReturnType<typeof makeTmpDb>['db'], id = 'hh') {
  db.insert(accounts).values({
    id, name: 'Household', institution: 'Legacy', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    createdAt: NOW, modifiedAt: NOW,
  }).run();
}

// The reference sheet's 2025 household totals, from the ROI-26 tab.
const HOUSEHOLD: LegacyClassRow[] = [{
  className: 'Total US Index',
  quarters: [
    { label: '2025 Q1', start: '2025-01-01', end: '2025-03-31', startValue: 1675448.11, endValue: 1480273.34, contributions: 23100.09 },
    { label: '2025 Q4', start: '2025-10-01', end: '2025-12-31', startValue: 1978064.71, endValue: 2023771.42, contributions: 5942.50 },
  ],
}];

describe('LEGACY_CLASS_TAGS', () => {
  it('maps the sheet class names used by the import', () => {
    expect(LEGACY_CLASS_TAGS['L-Cap Growth']).toMatchObject({ cap: 'large', style: 'growth', assetType: 'equity' });
    expect(LEGACY_CLASS_TAGS['Bond']).toMatchObject({ assetType: 'bond' });
    expect(LEGACY_CLASS_TAGS['Intl Dev Mkt']).toMatchObject({ region: 'intl_developed' });
  });
});

describe('importLegacyQuarters', () => {
  it('writes a snapshot at each quarter boundary and a flow per contribution', async () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    const result = await importLegacyQuarters('hh', HOUSEHOLD, db);

    expect(result.snapshots).toBe(4);   // start and end of each of two quarters
    expect(result.flows).toBe(2);

    const snaps = await listSnapshots('hh', db);
    expect(snaps.map((s) => s.asOf)).toEqual(
      ['2025-01-01', '2025-03-31', '2025-10-01', '2025-12-31']);
    expect(snaps.every((s) => s.source === 'legacy')).toBe(true);
  });

  it('creates tickerless synthetic securities prefixed Legacy:', async () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    await importLegacyQuarters('hh', HOUSEHOLD, db);
    const secs = db.select().from(securities).all();
    expect(secs).toHaveLength(1);
    expect(secs[0].ticker).toBeNull();
    expect(secs[0].name).toMatch(/^Legacy: /);
  });

  it('dates legacy flows at the quarter start so the sheet formula is reproduced', async () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    await importLegacyQuarters('hh', HOUSEHOLD, db);
    const flows = db.select().from(cashFlows).all().sort((a, b) => a.date.localeCompare(b.date));
    expect(flows[0].date).toBe('2025-01-01');
    expect(flows[0].amount).toBeCloseTo(23100.09, 2);
    expect(flows[0].source).toBe('legacy');
  });

  it('reproduces the sheet ROI for the quarters the sheet computed correctly', async () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    await importLegacyQuarters('hh', HOUSEHOLD, db);

    const snaps = await listSnapshots('hh', db);
    const purposes = new Map<string, Purpose>([['hh', 'portfolio']]);
    const flows = db.select().from(cashFlows).all()
      .map((f) => ({ id: f.id, accountId: f.accountId, date: f.date, amount: f.amount, kind: f.kind }));

    const q1 = purposeReturnBetween(snaps, purposes, [], flows, 'portfolio', '2025-01-01', '2025-03-31');
    expect(q1.kind).toBe('ok');
    if (q1.kind === 'ok') expect(q1.value).toBeCloseTo(-0.1285, 4);

    // Exact values, verified against the sheet: Q1 = -0.1285067, Q4 = 0.0200424.
    // Do not loosen these — they are the proof the import is faithful.
    const q4 = purposeReturnBetween(snaps, purposes, [], flows, 'portfolio', '2025-10-01', '2025-12-31');
    expect(q4.kind).toBe('ok');
    if (q4.kind === 'ok') expect(q4.value).toBeCloseTo(0.02004, 5);
  });

  it('records one contribution flow per class, each attributed to its security', async () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    const MULTI_CLASS: LegacyClassRow[] = [
      { className: 'Total US Index', quarters: [
        { label: '2025 Q1', start: '2025-01-01', end: '2025-03-31', startValue: 1000000, endValue: 1100000, contributions: 10000 }] },
      { className: 'Bond', quarters: [
        { label: '2025 Q1', start: '2025-01-01', end: '2025-03-31', startValue: 500000, endValue: 510000, contributions: 5000 }] },
    ];
    await importLegacyQuarters('hh', MULTI_CLASS, db);

    const flows = db.select().from(cashFlows).all().filter((f) => f.date === '2025-01-01');
    expect(flows).toHaveLength(2);   // one per class, no longer summed
    const secs = db.select().from(securities).all();
    const bondSec = secs.find((s) => s.name === 'Legacy: Bond')!;
    const usSec = secs.find((s) => s.name === 'Legacy: Total US Index')!;
    const byAmount = new Map(flows.map((f) => [f.amount, f.securityId]));
    expect(byAmount.get(5000)).toBe(bondSec.id);
    expect(byAmount.get(10000)).toBe(usSec.id);
    // Household ROI still sums both flows — unchanged.
    const total = flows.reduce((s, f) => s + f.amount, 0);
    expect(total).toBeCloseTo(15000, 2);
  });

  it('is idempotent', async () => {
    const { db } = makeTmpDb();
    seedAccount(db);
    await importLegacyQuarters('hh', HOUSEHOLD, db);
    await importLegacyQuarters('hh', HOUSEHOLD, db);
    expect(await listSnapshots('hh', db)).toHaveLength(4);
    expect(db.select().from(cashFlows).all()).toHaveLength(2);
  });
});
