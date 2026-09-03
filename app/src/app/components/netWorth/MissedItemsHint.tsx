'use client';

import { useEffect, useState } from 'react';
import { catalogByKey, type CatalogItem } from '@/lib/netWorth/catalog';
import type { RegisterRow } from '@/app/net-worth/page';

const DISMISS_KEY = 'wealthwise:networth:missed-hint-dismissed';

/**
 * Catalog items most households hold. Omitted DEBTS are the main reason a
 * computed net worth reads too optimistic, which is why three of these five are
 * liabilities rather than assets.
 */
const WATCH = ['hsa', 'five_two_nine', 'life_insurance_cash_value', 'heloc', 'student_loan'];

/** Pure: the commonly-held catalog items the user has not already added. */
export function missedItems(rows: RegisterRow[]): CatalogItem[] {
  return WATCH
    .map((k) => catalogByKey(k))
    .filter((c): c is CatalogItem => c !== undefined)
    .filter((c) => !rows.some((r) => r.name.toLowerCase().includes(c.label.toLowerCase())));
}

export default function MissedItemsHint({ rows }: { rows: RegisterRow[] }) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // Read in an effect, not during render: localStorage is unavailable during
    // SSR and would break hydration.
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  const missing = missedItems(rows);

  if (dismissed || missing.length === 0) return null;

  function dismiss() {
    try { window.localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode: hide for this session only */ }
    setDismissed(true);
  }

  return (
    <div className="origin-card p-[var(--space-3)] flex items-start justify-between gap-[var(--space-3)]">
      <div>
        <p className="text-small text-[var(--color-text-base-default)]">Commonly missed</p>
        <p className="text-xsmall text-[var(--color-text-base-subdued)]">
          People often forget these: {missing.map((c) => c.label).join(', ')}. Add any you hold.
        </p>
      </div>
      <button type="button" className="origin-btn origin-btn-ghost" onClick={dismiss}>Dismiss</button>
    </div>
  );
}
