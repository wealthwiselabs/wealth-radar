'use client';

import { useMemo } from 'react';
import { formatCurrency } from '@/lib/chartConfig';
import { monthlyExpenseTotals, trailingMonthlyAverage } from '@/lib/spending';
import type { Transaction } from '@/types';

interface TrailingAverageLabelProps {
  /** The same rows the monthly chart is drawing, so the two always agree. */
  transactions: Transaction[];
}

/**
 * Headline "what does a normal month cost" figure, sat beside a chart title.
 *
 * Renders nothing until at least one complete month exists — on a fresh
 * install the only month present is the current, partial one, and an average
 * of that is worse than no average at all.
 */
export default function TrailingAverageLabel({ transactions }: TrailingAverageLabelProps) {
  const average = useMemo(() => {
    // Local, not UTC: near a month boundary the UTC month can already have
    // rolled over, which would quietly drop the month the user is still in.
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return trailingMonthlyAverage(monthlyExpenseTotals(transactions), currentMonth);
  }, [transactions]);

  if (!average) return null;

  // The window is stated in the text itself ("6-month average"), so there is
  // nothing left for a tooltip to add — and with no tooltip there must be no
  // dotted underline or help cursor either, since both promise a hover
  // affordance that no longer exists.
  return (
    <span className="text-small text-[var(--color-text-base-subdued)]">
      {average.monthsUsed}-month average: {formatCurrency(average.average)}/mo
    </span>
  );
}
