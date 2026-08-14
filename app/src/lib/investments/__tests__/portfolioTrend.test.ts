import { describe, it, expect } from 'vitest';
import {
  mergeSeries,
  periodOverPeriodChange,
  type Series,
} from '@/lib/investments/portfolioTrend';

const pt = (periodKey: string, value: number | null, roi: number | null = null) => ({
  periodKey,
  label: periodKey,
  value,
  roi,
});

describe('mergeSeries', () => {
  it('aligns overlays onto the axis periods, gapping missing ones with null', () => {
    const axis: Series = {
      key: '',
      label: 'Total Portfolio',
      points: [pt('Q1', 100), pt('Q2', 120), pt('Q3', 130)],
    };
    const stock: Series = { key: 'Stock', label: 'Stock', points: [pt('Q2', 60), pt('Q3', 70)] };
    const merged = mergeSeries(axis, [stock]);
    expect(merged.periodKeys).toEqual(['Q1', 'Q2', 'Q3']);
    expect(merged.labels).toEqual(['Q1', 'Q2', 'Q3']);
    expect(merged.series[0]).toMatchObject({ key: '', value: [100, 120, 130] });
    expect(merged.series[1]).toMatchObject({ key: 'Stock', value: [null, 60, 70] });
  });

  it('carries roi through alongside value', () => {
    const axis: Series = {
      key: '',
      label: 'Total Portfolio',
      points: [pt('Q1', 100, 0.01), pt('Q2', 120, 0.02)],
    };
    const merged = mergeSeries(axis, []);
    expect(merged.series[0].roi).toEqual([0.01, 0.02]);
  });

  it('ignores overlay periods absent from the axis', () => {
    const axis: Series = { key: '', label: 'Total Portfolio', points: [pt('Q2', 120)] };
    const bond: Series = { key: 'Bond', label: 'Bond', points: [pt('Q1', 10), pt('Q2', 20)] };
    const merged = mergeSeries(axis, [bond]);
    expect(merged.periodKeys).toEqual(['Q2']);
    expect(merged.series[1].value).toEqual([20]);
  });
});

describe('periodOverPeriodChange', () => {
  it('computes the fractional change against the prior period', () => {
    expect(periodOverPeriodChange([100, 120, 90])).toEqual([null, 0.2, -0.25]);
  });

  it('nulls the first point and any point adjacent to a null or zero prior', () => {
    expect(periodOverPeriodChange([null, 100, null, 50])).toEqual([null, null, null, null]);
    expect(periodOverPeriodChange([0, 50])).toEqual([null, null]);
  });
});
