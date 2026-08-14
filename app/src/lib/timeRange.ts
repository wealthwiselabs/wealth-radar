import type { DateRange } from '@/types';

export type Preset =
  | 'all'
  | 'this-month'
  | 'last-month'
  | 'last-3-months'
  | 'last-6-months'
  | 'last-12-months'
  | 'this-year'
  | 'custom';

export const PRESET_LABELS: Record<Preset, string> = {
  'all': 'All Time',
  'this-month': 'This Month',
  'last-month': 'Last Month',
  'last-3-months': 'Last 3 Months',
  'last-6-months': 'Last 6 Months',
  'last-12-months': 'Last 12 Months',
  'this-year': 'This Year',
  'custom': 'Custom',
};

export const PRESET_ORDER: Preset[] = [
  'last-3-months',
  'last-6-months',
  'last-12-months',
  'this-month',
  'last-month',
  'this-year',
  'all',
  'custom',
];

export const DEFAULT_PRESET: Preset = 'all';

const STORAGE_KEY = 'expense-tracker:time-range';

const ymd = (d: Date) => d.toISOString().split('T')[0];

export function rangeForPreset(preset: Preset, custom?: DateRange): DateRange {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case 'all':
      return { startDate: '', endDate: '' };
    case 'this-month':
      return { startDate: ymd(new Date(y, m, 1)), endDate: ymd(new Date(y, m + 1, 0)) };
    case 'last-month':
      return { startDate: ymd(new Date(y, m - 1, 1)), endDate: ymd(new Date(y, m, 0)) };
    // N months back INCLUDING the current one, so "Last 3 Months" ends today's
    // month rather than starting three months before it.
    case 'last-3-months':
      return { startDate: ymd(new Date(y, m - 2, 1)), endDate: ymd(new Date(y, m + 1, 0)) };
    case 'last-6-months':
      return { startDate: ymd(new Date(y, m - 5, 1)), endDate: ymd(new Date(y, m + 1, 0)) };
    case 'last-12-months':
      return { startDate: ymd(new Date(y, m - 11, 1)), endDate: ymd(new Date(y, m + 1, 0)) };
    case 'this-year':
      return { startDate: ymd(new Date(y, 0, 1)), endDate: ymd(new Date(y, 11, 31)) };
    case 'custom':
      return custom ?? { startDate: '', endDate: '' };
  }
}

export interface StoredTimeRange {
  preset: Preset;
  startDate?: string;
  endDate?: string;
}

export function loadStoredTimeRange(): StoredTimeRange | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTimeRange;
    if (!parsed.preset || !PRESET_LABELS[parsed.preset]) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredTimeRange(value: StoredTimeRange): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}
