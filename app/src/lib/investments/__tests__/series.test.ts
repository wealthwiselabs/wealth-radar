import { describe, it, expect } from 'vitest';
import { buildValueSeries, purposeReturnBetween } from '@/lib/investments/series';
import type { SnapshotWithHoldings } from '@/lib/investments/snapshots';
import type { Purpose } from '@/lib/investments/purpose';
import type { FlowRow } from '@/lib/investments/transfers';

function snap(accountId: string, asOf: string, totalValue: number): SnapshotWithHoldings {
  return {
    id: `${accountId}-${asOf}`, accountId, asOf, month: asOf.slice(0, 7),
    source: 'paste', totalValue, holdingsComplete: false, holdings: [],
  };
}

const purposes = new Map<string, Purpose>([
  ['a1', 'portfolio'], ['a2', 'portfolio'], ['r1', 'reserve'], ['i1', 'insurance'],
]);

describe('buildValueSeries', () => {
  it('sums accounts sharing a date', () => {
    const s = buildValueSeries(
      [snap('a1', '2026-06-30', 100), snap('a2', '2026-06-30', 200)], purposes, [], 'portfolio');
    expect(s).toHaveLength(1);
    expect(s[0].value).toBe(300);
    expect(s[0].accountsCounted).toBe(2);
  });

  it('excludes accounts of a different purpose', () => {
    const s = buildValueSeries(
      [snap('a1', '2026-06-30', 100), snap('r1', '2026-06-30', 50)], purposes, [], 'portfolio');
    expect(s[0].value).toBe(100);
    const r = buildValueSeries(
      [snap('a1', '2026-06-30', 100), snap('r1', '2026-06-30', 50)], purposes, [], 'reserve');
    expect(r[0].value).toBe(50);
  });

  it('carries an account forward when it is absent on a later date', () => {
    // a2 last reported 200 in May; June only re-snapshots a1. The June total
    // carries a2's 200 forward rather than dropping it, so the line reflects
    // the household's actual balance instead of a partial dip.
    const s = buildValueSeries([
      snap('a1', '2026-05-31', 100), snap('a2', '2026-05-31', 200),
      snap('a1', '2026-06-30', 110),
    ], purposes, [], 'portfolio');
    const june = s.find((p) => p.asOf === '2026-06-30')!;
    expect(june.value).toBe(310);
    expect(june.accountsMissing).toEqual([]);
    expect(june.accountsCounted).toBe(2);
  });

  it('sorts points by date', () => {
    const s = buildValueSeries(
      [snap('a1', '2026-06-30', 2), snap('a1', '2026-05-31', 1)], purposes, [], 'portfolio');
    expect(s.map((p) => p.asOf)).toEqual(['2026-05-31', '2026-06-30']);
  });

  it('keeps the trailing point complete by carrying every account forward', () => {
    // The newest point is the one a summary tile reads. Carrying each account's
    // last-known value forward means the trailing total is always the full
    // household balance, never a partial sum.
    const s = buildValueSeries([
      snap('a1', '2026-05-31', 100), snap('a2', '2026-05-31', 200),
      snap('a1', '2026-06-30', 110),
    ], purposes, [], 'portfolio');
    const last = s[s.length - 1];
    expect(last.asOf).toBe('2026-06-30');
    expect(last.value).toBe(310);
    expect(last.accountsMissing).toEqual([]);
    expect(last.accountsCounted).toBe(2);
  });

  it('emits no point for a date on which only an unrelated purpose reported', () => {
    // Capturing the IUL is not an event in the portfolio's history. A point
    // here would puncture the portfolio line with a meaningless gap and make
    // the insurance capture the portfolio's apparent latest reading.
    const s = buildValueSeries([
      snap('a1', '2026-05-31', 100),
      snap('i1', '2026-07-05', 500),
    ], purposes, [], 'portfolio');
    expect(s.map((p) => p.asOf)).toEqual(['2026-05-31']);

    const r = buildValueSeries([
      snap('r1', '2026-05-31', 40),
      snap('i1', '2026-07-05', 500),
    ], purposes, [], 'reserve');
    expect(r.map((p) => p.asOf)).toEqual(['2026-05-31']);

    // The insurance series itself still sees its own date.
    const ins = buildValueSeries([
      snap('a1', '2026-05-31', 100),
      snap('i1', '2026-07-05', 500),
    ], purposes, [], 'insurance');
    expect(ins.map((p) => p.asOf)).toEqual(['2026-07-05']);
  });

  it('emits a point on every relevant date, carrying absent accounts forward', () => {
    const s = buildValueSeries([
      snap('a1', '2026-05-31', 100), snap('a2', '2026-05-31', 200),
      snap('a1', '2026-06-30', 110), snap('i1', '2026-07-05', 500),
    ], purposes, [], 'portfolio');
    expect(s.map((p) => p.asOf)).toEqual(['2026-05-31', '2026-06-30']);
    expect(s[1].accountsMissing).toEqual([]);
    expect(s[1].value).toBe(310);
  });

  it('draws a continuous total for accounts snapshotted on different dates', () => {
    // The reported bug: two reserve accounts captured on different dates left
    // the line undrawable because most dates were "partial". Carry-forward sums
    // each account's latest value, so once every account has first reported the
    // line is continuous.
    const p = new Map<string, Purpose>([['r1', 'reserve'], ['r2', 'reserve']]);
    const s = buildValueSeries([
      snap('r1', '2026-06-04', 2000),
      snap('r2', '2026-07-04', 5000),
      snap('r1', '2026-08-04', 320.76),
      snap('r2', '2026-08-04', 6000),
    ], p, [], 'reserve');
    expect(s.map((x) => x.asOf)).toEqual(['2026-06-04', '2026-07-04', '2026-08-04']);
    // Before r2's first snapshot the total is just r1; r2 is not yet counted.
    expect(s[0].value).toBe(2000);
    expect(s[0].accountsMissing).toEqual(['r2']);
    // r1 (2000) carries forward and sums with r2 (5000) = 7000, complete.
    expect(s[1].value).toBe(7000);
    expect(s[1].accountsMissing).toEqual([]);
    // Both fresh on the last date.
    expect(s[2].value).toBeCloseTo(6320.76, 2);
    expect(s[2].accountsMissing).toEqual([]);
  });

  it('does not list an account in accountsMissing when it reported a real $0', () => {
    const s = buildValueSeries([
      snap('a1', '2026-05-31', 100), snap('a2', '2026-05-31', 50),
      snap('a1', '2026-06-30', 110), snap('a2', '2026-06-30', 0),
    ], purposes, [], 'portfolio');
    const june = s.find((p) => p.asOf === '2026-06-30')!;
    expect(june.accountsMissing).toEqual([]);
    expect(june.accountsCounted).toBe(2);
  });
});

describe('purposeReturnBetween', () => {
  const snapshots = [snap('a1', '2026-01-01', 1000), snap('a1', '2026-01-31', 1200)];

  it('computes a return over accounts present at both ends', () => {
    const flows: FlowRow[] = [
      { id: 'f1', accountId: 'a1', date: '2026-01-16', amount: 100, kind: 'contribution' },
    ];
    const r = purposeReturnBetween(snapshots, purposes, [], flows, 'portfolio', '2026-01-01', '2026-01-31');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.value).toBeCloseTo(100 / 1050, 10);
  });

  it('nets an inter-account transfer out of household flows', () => {
    const both = [
      snap('a1', '2026-01-01', 1000), snap('a2', '2026-01-01', 1000),
      snap('a1', '2026-01-31', 500), snap('a2', '2026-01-31', 1600),
    ];
    // Dates must differ (still inside the 5-day matching window) or the
    // amounts cancel identically in Modified Dietz whether or not netting
    // runs, making the assertion pass vacuously. With these dates, netted
    // gives 0.05; un-netted would give 100/1950 ≈ 0.05128.
    const flows: FlowRow[] = [
      { id: 'o', accountId: 'a1', date: '2026-01-15', amount: -500, kind: 'transfer_out' },
      { id: 'i', accountId: 'a2', date: '2026-01-18', amount: 500, kind: 'transfer_in' },
    ];
    // Household went 2000 -> 2100 with no external money: a 5% gain, not a wash.
    const r = purposeReturnBetween(both, purposes, [], flows, 'portfolio', '2026-01-01', '2026-01-31');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.value).toBeCloseTo(0.05, 10);
  });

  it('reports missing when an account lacks a snapshot at an endpoint', () => {
    const partial = [snap('a1', '2026-01-01', 1000), snap('a2', '2026-01-01', 1000), snap('a1', '2026-01-31', 1100)];
    const r = purposeReturnBetween(partial, purposes, [], [], 'portfolio', '2026-01-01', '2026-01-31');
    expect(r.kind).toBe('missing');
  });

  it('reports missing when no snapshot exists at all', () => {
    const r = purposeReturnBetween([], purposes, [], [], 'portfolio', '2026-01-01', '2026-01-31');
    expect(r.kind).toBe('missing');
  });

  it('reports missing when a relevant account has a $0 snapshot at one end and none at the other', () => {
    const partial = [
      snap('a1', '2026-01-01', 1000), snap('a1', '2026-01-31', 1100),
      snap('a2', '2026-01-01', 0),
    ];
    const r = purposeReturnBetween(partial, purposes, [], [], 'portfolio', '2026-01-01', '2026-01-31');
    expect(r.kind).toBe('missing');
  });
});
