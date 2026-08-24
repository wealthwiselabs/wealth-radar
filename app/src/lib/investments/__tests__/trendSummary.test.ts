import { describe, it, expect } from 'vitest';
import { summarizeWindow, formatMonthYear, type PurposeOverall } from '@/lib/investments/trendSummary';

const complete: PurposeOverall = {
  roi: 0.042, gain: 800, startValue: 20000, endValue: 21200,
  accountsCounted: 1, accountsMissing: [], accountsInWindow: 1,
};

describe('summarizeWindow', () => {
  it('derives value change as end minus start', () => {
    const s = summarizeWindow(complete, '2026-01-31', '2026-08-31');
    expect(s.valueChange).toBe(1200);
  });

  it('carries through ROI, start, and end', () => {
    const s = summarizeWindow(complete, '2026-01-31', '2026-08-31');
    expect(s.roi).toBe(0.042);
    expect(s.startValue).toBe(20000);
    expect(s.endValue).toBe(21200);
  });

  it('labels the window as Month Year – Month Year', () => {
    const s = summarizeWindow(complete, '2026-01-31', '2026-08-31');
    expect(s.windowLabel).toBe('Jan 2026 – Aug 2026');
  });

  it('reports complete coverage when nothing is missing and counts agree', () => {
    expect(summarizeWindow(complete, '2026-01-31', '2026-08-31').coverageComplete).toBe(true);
  });

  it('reports incomplete coverage when an account is missing', () => {
    const s = summarizeWindow({ ...complete, accountsMissing: ['Fidelity · 529'] }, '2026-01-31', '2026-08-31');
    expect(s.coverageComplete).toBe(false);
  });

  it('reports incomplete coverage when a windowed account was silently dropped', () => {
    // An account reported within the window but never resolved a boundary pair:
    // accountsCounted < accountsInWindow even though accountsMissing is empty.
    const s = summarizeWindow({ ...complete, accountsCounted: 1, accountsInWindow: 2 }, '2026-01-31', '2026-08-31');
    expect(s.coverageComplete).toBe(false);
  });

  it('leaves value change null when either endpoint is unknown', () => {
    expect(summarizeWindow({ ...complete, startValue: null }, '2026-01-31', '2026-08-31').valueChange).toBeNull();
    expect(summarizeWindow({ ...complete, endValue: null }, '2026-01-31', '2026-08-31').valueChange).toBeNull();
  });
});

describe('formatMonthYear', () => {
  it('formats an ISO date as short month and full year in UTC', () => {
    expect(formatMonthYear('2026-01-31')).toBe('Jan 2026');
    expect(formatMonthYear('2026-12-01')).toBe('Dec 2026');
  });
});
