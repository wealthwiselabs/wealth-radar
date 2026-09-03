import { describe, it, expect } from 'vitest';
import { missedItems } from '@/app/components/netWorth/MissedItemsHint';
import type { RegisterRow } from '@/app/net-worth/page';

// The component's visibility depends on useEffect + localStorage, neither of
// which exists under static rendering. Export the selection as a pure function
// and test that; the dismiss behaviour is a per-viewer convenience, not logic
// worth a DOM harness.
const row = (name: string): RegisterRow => ({
  accountId: name, name, side: 'asset', group: 'other', value: 1, lastAsOf: '2026-08-01',
  source: 'manual', reviewIntervalMonths: null, securedByAccountId: null,
  valueLow: null, valueHigh: null, valuationRef: null, debtGroup: null, canDelete: false,
});

describe('missedItems', () => {
  it('names commonly-held items the user has not added', () => {
    expect(missedItems([]).map((c) => c.key)).toContain('hsa');
  });

  it('drops an item the user already tracks', () => {
    expect(missedItems([row('HSA')]).map((c) => c.key)).not.toContain('hsa');
  });

  it('includes the debts people most often forget', () => {
    // Omitted debts are the main reason a computed net worth reads too
    // optimistic, so these matter more than the asset suggestions.
    const keys = missedItems([]).map((c) => c.key);
    expect(keys).toContain('heloc');
    expect(keys).toContain('student_loan');
  });
});
