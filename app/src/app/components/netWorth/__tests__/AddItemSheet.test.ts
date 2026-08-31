import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AddItemSheet, { catalogOptions } from '@/app/components/netWorth/AddItemSheet';
import { catalogByKey } from '@/lib/netWorth/catalog';

// The sheet's body lives behind `open` state, which static rendering cannot
// reach. So: the pure option-filtering is unit-tested here, the collapsed
// render is pinned here, and opening/picking/saving is covered by the E2E.
describe('catalogOptions', () => {
  it('offers only items for the requested side', () => {
    expect(catalogOptions('liability', '').every((c) => c.side === 'liability')).toBe(true);
    expect(catalogOptions('asset', '').every((c) => c.side === 'asset')).toBe(true);
  });

  it('matches on label, case-insensitively', () => {
    expect(catalogOptions('asset', 'life insurance').map((c) => c.key))
      .toContain('life_insurance_cash_value');
    expect(catalogOptions('asset', 'LIFE INSURANCE').map((c) => c.key))
      .toContain('life_insurance_cash_value');
  });

  it('never offers a liability template on the asset side', () => {
    expect(catalogOptions('asset', 'mortgage')).toEqual([]);
  });
});

describe('the hints that prevent wrong numbers', () => {
  // These strings are the highest-value content in the catalog; a later task
  // renders them under the value field. Pin them at the source.
  it('tells the user to use cash surrender value, not the death benefit', () => {
    expect(catalogByKey('life_insurance_cash_value')?.hint).toMatch(/cash surrender value/i);
  });
  it('restricts a pension to a plan-reported figure', () => {
    expect(catalogByKey('pension')?.hint).toMatch(/lump-sum|present-value/i);
  });
});

describe('AddItemSheet', () => {
  it('renders only the add control until it is opened', () => {
    const out = renderToStaticMarkup(createElement(AddItemSheet, {
      side: 'asset' as const, existingAssets: [], onCreated: () => {},
    }));
    expect(out).toContain('Add item');
    expect(out).not.toContain('Search items');
  });
});
