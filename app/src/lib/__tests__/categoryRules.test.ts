import { describe, it, expect } from 'vitest';
import {
  normalizePattern, isValidPattern, matchesPattern, resolveRule,
} from '@/lib/categoryRules';
import type { CategoryRule } from '@/types';

function rule(over: Partial<CategoryRule>): CategoryRule {
  return {
    id: 'r', pattern: 'x', categoryId: 'c', subcategoryId: 's', enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('normalizePattern', () => {
  it('lowercases, trims, and collapses internal whitespace', () => {
    expect(normalizePattern('  Kindle   Svcs  ')).toBe('kindle svcs');
  });
});

describe('isValidPattern', () => {
  it('accepts three characters', () => expect(isValidPattern('atm')).toBe(true));
  it('rejects two characters', () => expect(isValidPattern('at')).toBe(false));
  it('rejects whitespace-only input', () => expect(isValidPattern('   ')).toBe(false));
});

describe('matchesPattern', () => {
  it('matches case-insensitively anywhere in the description', () => {
    expect(matchesPattern('Kindle Svcs*BV80P7WZ2', 'kindle svcs')).toBe(true);
  });
  it('matches a merchant behind a payment prefix', () => {
    expect(matchesPattern('AplPay TEMU.COM 519079 SANTA MONICA CA', 'temu.com')).toBe(true);
  });
  it('does not match an unrelated description', () => {
    expect(matchesPattern('SAFEWAY #0700', 'kindle svcs')).toBe(false);
  });
});

describe('resolveRule', () => {
  const costco = rule({ id: 'a', pattern: 'costco', categoryId: 'food', subcategoryId: 'grocery' });
  const costcoGas = rule({ id: 'b', pattern: 'costco gas', categoryId: 'transportation', subcategoryId: 'fuel' });

  it('picks the longest matching pattern', () => {
    const got = resolveRule('COSTCO GAS #0423 SUNNYVALE CA', [costco, costcoGas]);
    expect(got?.id).toBe('b');
  });

  it('falls back to the shorter pattern when the longer does not match', () => {
    const got = resolveRule('COSTCO WHSE #0423 SUNNYVALE CA', [costco, costcoGas]);
    expect(got?.id).toBe('a');
  });

  it('ignores disabled rules', () => {
    const got = resolveRule('COSTCO GAS #0423', [costco, rule({ ...costcoGas, enabled: false })]);
    expect(got?.id).toBe('a');
  });

  it('breaks equal-length ties on the most recent updatedAt', () => {
    const older = rule({ id: 'old', pattern: 'target', updatedAt: '2026-01-01T00:00:00.000Z' });
    const newer = rule({ id: 'new', pattern: 'target', updatedAt: '2026-06-01T00:00:00.000Z' });
    expect(resolveRule('TARGET 00012', [older, newer])?.id).toBe('new');
    expect(resolveRule('TARGET 00012', [newer, older])?.id).toBe('new');
  });

  it('returns null when nothing matches', () => {
    expect(resolveRule('MYSTERY MERCHANT', [costco])).toBeNull();
  });
});
