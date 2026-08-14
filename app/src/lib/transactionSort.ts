export type SortKey = 'date' | 'amount' | 'category' | 'subcategory';
export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/**
 * Direction a column gets the first time it is clicked.
 *
 * Dates start newest-first because that is how a statement reads. Amount
 * starts ascending: amounts are signed, so the most negative row is the
 * biggest expense, which is what someone clicking "Amount" is looking for.
 */
const FIRST_CLICK_DIR: Record<SortKey, SortDir> = {
  date: 'desc',
  amount: 'asc',
  category: 'asc',
  subcategory: 'asc',
};

/** Clicking the active column flips it; clicking a new one uses its default. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: FIRST_CLICK_DIR[key] };
}

export const DEFAULT_SORT: SortState = { key: 'date', dir: 'desc' };

interface SortableRow {
  date: string;
  amount: number;
}

interface Labels<T> {
  category: (t: T) => string;
  subcategory: (t: T) => string;
}

/**
 * Sort a COPY of the rows. Category and subcategory sort on the displayed
 * names, not the underlying IDs, so the order matches what is on screen.
 *
 * Callers must sort the whole filtered set before paginating — sorting only
 * the visible page would silently reorder within it and never surface the
 * largest amount in the data.
 */
export function sortTransactions<T extends SortableRow>(
  rows: readonly T[],
  { key, dir }: SortState,
  labels: Labels<T>,
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  const compare = (a: T, b: T): number => {
    switch (key) {
      case 'date':
        return a.date.localeCompare(b.date);
      case 'amount':
        return a.amount - b.amount;
      case 'category':
        return labels.category(a).localeCompare(labels.category(b));
      case 'subcategory':
        return labels.subcategory(a).localeCompare(labels.subcategory(b));
    }
  };
  return [...rows].sort((a, b) => {
    const primary = compare(a, b) * sign;
    // Ties fall back to newest-first so equal categories/amounts keep a stable,
    // meaningful order rather than whatever the input happened to be.
    return primary !== 0 ? primary : b.date.localeCompare(a.date);
  });
}
