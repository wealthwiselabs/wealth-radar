import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BalanceSheet from '@/app/components/netWorth/BalanceSheet';
import { formatCurrency, formatSignedCurrency } from '@/lib/chartConfig';
import type { RegisterRow } from '@/app/net-worth/page';

// Static rendering, matching MarkdownMessage.test.ts — this repo has no jsdom or
// testing-library. Interactions (typing a value, the negative-amount error,
// remove/close) cannot be exercised here and are covered by the Playwright E2E.
const row = (over: Partial<RegisterRow>): RegisterRow => ({
  accountId: 'a1', name: 'Home', side: 'asset', group: 'property', value: 1_150_000,
  lastAsOf: '2026-08-01', source: 'manual', reviewIntervalMonths: 12,
  securedByAccountId: null, valueLow: null, valueHigh: null, valuationRef: null, canDelete: false, ...over,
});

const html = (rows: RegisterRow[]) =>
  renderToStaticMarkup(createElement(BalanceSheet, { rows, onChanged: () => {} }));

describe('BalanceSheet', () => {
  it('renders an unvalued item as an em dash, never as zero', () => {
    const out = html([row({ name: 'Second car', value: null, lastAsOf: null })]);
    expect(out).toContain('—');
    expect(out).not.toContain('$0.00');
  });

  it('totals each side separately', () => {
    const out = html([
      row({}),
      row({ accountId: 'a2', name: 'Mortgage', side: 'liability', group: 'debt', value: 620_000 }),
    ]);
    expect(out).toContain('assets-total');
    expect(out).toContain('1,150,000');
    expect(out).toContain('620,000');
  });

  it('nests a secured liability under its asset and shows the equity', () => {
    const out = html([
      row({}),
      row({ accountId: 'a2', name: 'Mortgage', side: 'liability', group: 'debt',
            value: 620_000, securedByAccountId: 'a1' }),
    ]);
    // 1,150,000 house less a 620,000 mortgage.
    expect(out).toContain('equity-a1');
    expect(out).toContain('530,000');
  });

  it('offers a value input labelled per row, so the E2E can target it', () => {
    // The interaction itself is E2E-only; this pins the accessible label the
    // E2E selects on, so a rename breaks here rather than silently there.
    expect(html([row({})])).toContain('Value for Home');
  });

  it('marks a row past its review interval differently from a fresh one', () => {
    const stale = html([row({ lastAsOf: '2020-01-01', reviewIntervalMonths: 12 })]);
    const fresh = html([row({ lastAsOf: '2026-08-01', reviewIntervalMonths: 12 })]);
    expect(stale).not.toBe(fresh);
    expect(stale).toContain('2020-01-01');
  });

  it('renders negative equity (underwater) with a minus sign, not as a plain positive figure', () => {
    const out = html([
      row({}), // Home, value 1,150,000
      row({ accountId: 'a2', name: 'Mortgage', side: 'liability', group: 'debt',
            value: 1_300_000, securedByAccountId: 'a1' }),
    ]);
    // 1,150,000 house less a 1,300,000 mortgage: underwater by 150,000.
    expect(out).toContain('-$150,000');
  });
});

describe('formatSignedCurrency vs formatCurrency', () => {
  it('formatSignedCurrency preserves a negative sign', () => {
    expect(formatSignedCurrency(-150_000)).toBe('-$150,000');
    expect(formatSignedCurrency(150_000)).toBe('$150,000');
  });

  it('formatCurrency discards sign (unchanged legacy behaviour for chart tooltips/axes)', () => {
    expect(formatCurrency(-150_000)).toBe('$150,000');
    expect(formatCurrency(150_000)).toBe('$150,000');
  });
});
