// src/lib/investments/periods.ts
import { daysBetween } from '@/lib/investments/returns';
import type { SnapshotWithHoldings } from '@/lib/investments/snapshots';

export type PeriodBasis = 'monthly' | 'quarterly';

export interface Period {
  key: string;        // 'monthly:2026-06' | 'quarterly:2025-Q1'
  label: string;      // "Jun '26" | "2025 Q1"
  basis: PeriodBasis;
  openDate: string;   // YYYY-MM-DD — previous period's close
  closeDate: string;  // YYYY-MM-DD
  months?: Period[];  // quarterly only: the three monthly sub-periods, for chaining
}

// Half a period, roughly: a statement landing a couple of weeks off still counts,
// but a snapshot a whole period away never masquerades as a boundary reading.
export const MONTHLY_TOLERANCE_DAYS = 16;
export const QUARTERLY_TOLERANCE_DAYS = 20;

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** Last calendar day of the month containing 1-based (year, month). */
function monthEnd(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0));   // day 0 of next month = last day of this
  return d.toISOString().slice(0, 10);
}

function monthLabel(year: number, month: number): string {
  return `${MONTH_ABBR[month - 1]} '${String(year).slice(2)}`;
}

function shiftMonths(iso: string, delta: number): string {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthlyPeriod(year: number, month: number): Period {
  const close = monthEnd(year, month);
  const prev = new Date(Date.UTC(year, month - 1, 0));   // last day of previous month
  return {
    key: `monthly:${year}-${String(month).padStart(2, '0')}`,
    label: monthLabel(year, month),
    basis: 'monthly',
    openDate: prev.toISOString().slice(0, 10),
    closeDate: close,
  };
}

function quarterlyPeriod(year: number, quarter: number): Period {
  const endMonth = quarter * 3;                 // Q1 -> 3, Q4 -> 12
  const close = monthEnd(year, endMonth);
  const openPrev = new Date(Date.UTC(year, endMonth - 3, 0));  // last day of prior quarter
  const months = [endMonth - 2, endMonth - 1, endMonth].map((m) => monthlyPeriod(year, m));
  return {
    key: `quarterly:${year}-Q${quarter}`,
    label: `${year} Q${quarter}`,
    basis: 'quarterly',
    openDate: openPrev.toISOString().slice(0, 10),
    closeDate: close,
    months,
  };
}

export function generatePeriods(from: string, to: string, basis: PeriodBasis): Period[] {
  const out: Period[] = [];
  if (basis === 'monthly') {
    let cursor = from.slice(0, 7);
    const last = to.slice(0, 7);
    while (cursor <= last) {
      const [y, m] = cursor.split('-').map(Number);
      const p = monthlyPeriod(y, m);
      if (p.closeDate >= from && p.closeDate <= to) out.push(p);
      cursor = shiftMonths(`${cursor}-01`, 1);
    }
    return out;
  }
  // quarterly
  const startYear = Number(from.slice(0, 4));
  const endYear = Number(to.slice(0, 4));
  for (let y = startYear; y <= endYear; y++) {
    for (let q = 1; q <= 4; q++) {
      const p = quarterlyPeriod(y, q);
      if (p.closeDate >= from && p.closeDate <= to) out.push(p);
    }
  }
  return out;
}

export function resolveBoundary(
  accountSnaps: SnapshotWithHoldings[],
  boundaryDate: string,
  toleranceDays: number,
): SnapshotWithHoldings | null {
  let best: SnapshotWithHoldings | null = null;
  let bestGap = Infinity;
  for (const s of accountSnaps) {
    const gap = Math.abs(daysBetween(boundaryDate, s.asOf));
    if (gap > toleranceDays) continue;
    // Strictly closer wins; on a tie prefer the snapshot on/before the boundary
    // (a value already reported, not one from just after).
    const onOrBefore = s.asOf <= boundaryDate;
    const bestOnOrBefore = best !== null && best.asOf <= boundaryDate;
    if (gap < bestGap || (gap === bestGap && onOrBefore && !bestOnOrBefore)) {
      best = s;
      bestGap = gap;
    }
  }
  return best;
}

export function rangeToDates(
  basis: PeriodBasis,
  count: number | 'all',
  earliest: string | null,
  today: string,
): { from: string; to: string } {
  const trailingMonths = basis === 'quarterly'
    ? (count === 'all' ? 12 : count * 3)   // 'all' fallback default: 12 months
    : (count === 'all' ? 12 : count);
  const fallback = shiftMonths(today, -trailingMonths) + today.slice(7);
  if (count === 'all') {
    return { from: earliest ?? fallback, to: today };
  }
  return { from: fallback, to: today };
}

export type AllocationBasis = 'monthly' | 'quarterly' | 'yearly';

export interface AllocationPeriod {
  key: string; label: string; basis: AllocationBasis;
  startDate: string; endDate: string;
  subPeriods?: AllocationPeriod[];   // yearly: its four quarters
  // Trailing-range mode: resolve boundaries by carry-forward (latest complete
  // snapshot at/before the date) rather than nearest-within-tolerance. Used by
  // the range-based Asset snapshot; unset for calendar periods.
  carryForward?: boolean;
}

export const ALLOCATION_TOLERANCE: Record<AllocationBasis, number> = {
  monthly: 16, quarterly: 20, yearly: 20,
};

const pad = (n: number) => String(n).padStart(2, '0');

export function allocationPeriod(basis: AllocationBasis, year: number, index: number): AllocationPeriod {
  if (basis === 'monthly') {
    return {
      key: `monthly:${year}-${pad(index)}`, label: monthLabel(year, index), basis,
      startDate: `${year}-${pad(index)}-01`, endDate: monthEnd(year, index),
    };
  }
  if (basis === 'quarterly') {
    const startMonth = (index - 1) * 3 + 1;
    return {
      key: `quarterly:${year}-Q${index}`, label: `${year} Q${index}`, basis,
      startDate: `${year}-${pad(startMonth)}-01`, endDate: monthEnd(year, index * 3),
    };
  }
  return {
    key: `yearly:${year}`, label: `${year}`, basis: 'yearly',
    startDate: `${year}-01-01`, endDate: `${year}-12-31`,
    subPeriods: [1, 2, 3, 4].map((q) => allocationPeriod('quarterly', year, q)),
  };
}

export function enumerateAllocationPeriods(from: string, to: string, basis: AllocationBasis): AllocationPeriod[] {
  const out: AllocationPeriod[] = [];
  const y0 = Number(from.slice(0, 4)), y1 = Number(to.slice(0, 4));
  for (let y = y0; y <= y1; y++) {
    const idxs = basis === 'monthly' ? [1,2,3,4,5,6,7,8,9,10,11,12] : basis === 'quarterly' ? [1,2,3,4] : [0];
    for (const i of idxs) {
      const p = allocationPeriod(basis, y, i);
      if (p.endDate >= from && p.endDate <= to) out.push(p);
    }
  }
  return out;
}
