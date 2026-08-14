import { describe, it, expect } from 'vitest';
import {
  effectivePurpose, purposeValue, accountHoldsPurpose, holdingsForPurpose, purposeValueMulti,
  PURPOSES,
  type PurposeOverride,
} from '@/lib/investments/purpose';
import type { SnapshotWithHoldings } from '@/lib/investments/snapshots';

function snap(over: Partial<SnapshotWithHoldings> = {}): SnapshotWithHoldings {
  return {
    id: 'sn1', accountId: 'a1', asOf: '2026-07-31', month: '2026-07',
    source: 'paste', totalValue: 1000, holdingsComplete: false, holdings: [],
    ...over,
  };
}

describe('effectivePurpose', () => {
  it('falls back to the account purpose when there is no override', () => {
    expect(effectivePurpose('portfolio', undefined)).toBe('portfolio');
  });
  it('prefers the override', () => {
    expect(effectivePurpose('portfolio', 'reserve')).toBe('reserve');
  });
});

describe('purposeValue', () => {
  it('returns the account total for a single-purpose account', () => {
    expect(purposeValue(snap(), 'portfolio', [], 'portfolio')).toBe(1000);
  });

  it('returns 0 when asked for a purpose the account does not hold', () => {
    expect(purposeValue(snap(), 'portfolio', [], 'reserve')).toBe(0);
  });

  it('splits a mixed-purpose account by holding', () => {
    const overrides: PurposeOverride[] = [{ accountId: 'a1', securityId: 'vmfxx', purpose: 'reserve' }];
    const s = snap({
      totalValue: 1000, holdingsComplete: true,
      holdings: [
        { securityId: 'vti', quantity: 3, value: 700 },
        { securityId: 'vmfxx', quantity: 300, value: 300 },
      ],
    });
    expect(purposeValue(s, 'portfolio', overrides, 'portfolio')).toBe(700);
    expect(purposeValue(s, 'portfolio', overrides, 'reserve')).toBe(300);
  });

  it('returns null for a mixed-purpose account whose holdings are incomplete', () => {
    const overrides: PurposeOverride[] = [{ accountId: 'a1', securityId: 'vmfxx', purpose: 'reserve' }];
    const s = snap({ totalValue: 1000, holdingsComplete: false, holdings: [] });
    expect(purposeValue(s, 'portfolio', overrides, 'portfolio')).toBeNull();
  });

  it('ignores overrides belonging to a different account', () => {
    const overrides: PurposeOverride[] = [{ accountId: 'OTHER', securityId: 'vmfxx', purpose: 'reserve' }];
    expect(purposeValue(snap(), 'portfolio', overrides, 'portfolio')).toBe(1000);
  });
});

const MIXED: PurposeOverride[] = [{ accountId: 'a1', securityId: 'vusxx', purpose: 'reserve' }];

const mixedSnap = () => snap({
  totalValue: 1000, holdingsComplete: true,
  holdings: [
    { securityId: 'vti', quantity: 3, value: 700 },
    { securityId: 'vusxx', quantity: 300, value: 300 },
  ],
});

describe('accountHoldsPurpose', () => {
  it('is true when the account purpose itself is a target', () => {
    expect(accountHoldsPurpose('a1', 'portfolio', [], ['portfolio'])).toBe(true);
  });
  it('is false when neither the account purpose nor any override matches', () => {
    expect(accountHoldsPurpose('a1', 'portfolio', [], ['reserve'])).toBe(false);
  });
  it('is true when an override for THIS account matches', () => {
    expect(accountHoldsPurpose('a1', 'portfolio', MIXED, ['reserve'])).toBe(true);
  });
  it('ignores overrides belonging to another account', () => {
    const other: PurposeOverride[] = [{ accountId: 'OTHER', securityId: 'vusxx', purpose: 'reserve' }];
    expect(accountHoldsPurpose('a1', 'portfolio', other, ['reserve'])).toBe(false);
  });
  it('is true when any one of several targets matches', () => {
    expect(accountHoldsPurpose('a1', 'reserve', [], ['portfolio', 'reserve'])).toBe(true);
  });
});

describe('holdingsForPurpose', () => {
  it('keeps only holdings whose effective purpose is a target', () => {
    expect(holdingsForPurpose(mixedSnap(), 'portfolio', MIXED, ['portfolio']).map((h) => h.securityId))
      .toEqual(['vti']);
    expect(holdingsForPurpose(mixedSnap(), 'portfolio', MIXED, ['reserve']).map((h) => h.securityId))
      .toEqual(['vusxx']);
  });
  it('keeps every holding when both purposes are targeted', () => {
    expect(holdingsForPurpose(mixedSnap(), 'portfolio', MIXED, ['portfolio', 'reserve']).length).toBe(2);
  });
  it('returns an empty list when the account holds nothing of the target', () => {
    expect(holdingsForPurpose(mixedSnap(), 'portfolio', [], ['insurance'])).toEqual([]);
  });
});

describe('purposeValueMulti', () => {
  it('sums across targets', () => {
    expect(purposeValueMulti(mixedSnap(), 'portfolio', MIXED, ['portfolio', 'reserve'])).toBe(1000);
    expect(purposeValueMulti(mixedSnap(), 'portfolio', MIXED, ['reserve'])).toBe(300);
  });
  it('uses the reported total for a single-purpose account with no holdings detail', () => {
    expect(purposeValueMulti(snap({ totalValue: 500 }), 'reserve', [], ['reserve'])).toBe(500);
  });
  it('is null when any target is unknowable', () => {
    const s = snap({ totalValue: 1000, holdingsComplete: false, holdings: [] });
    expect(purposeValueMulti(s, 'portfolio', MIXED, ['portfolio'])).toBeNull();
  });
});

describe('education purpose', () => {
  it('is a registered purpose', () => {
    expect(PURPOSES).toContain('education');
  });
  it('is excluded from a portfolio target and included in an education target', () => {
    const s = snap({ accountId: 'e1', totalValue: 50000 });
    expect(purposeValue(s, 'education', [], 'portfolio')).toBe(0);
    expect(purposeValue(s, 'education', [], 'education')).toBe(50000);
  });
  it('accountHoldsPurpose distinguishes education from portfolio', () => {
    expect(accountHoldsPurpose('e1', 'education', [], ['portfolio'])).toBe(false);
    expect(accountHoldsPurpose('e1', 'education', [], ['education'])).toBe(true);
  });
});
