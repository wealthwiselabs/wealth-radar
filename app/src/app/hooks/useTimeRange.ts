'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_PRESET, type Preset, loadStoredTimeRange, rangeForPreset,
} from '@/lib/timeRange';
import type { DateRange } from '@/types';

/**
 * The app's one time range, shared by the homepage, /investments and /reserve
 * through the `expense-tracker:time-range` localStorage key.
 *
 * Restoring on mount rather than during render keeps the server and client
 * markup identical — reading localStorage in the initial state would hydrate
 * with a different range than the server rendered.
 */
export function useTimeRange() {
  const [preset, setPreset] = useState<Preset>(DEFAULT_PRESET);
  const [customRange, setCustomRange] = useState<DateRange>({ startDate: '', endDate: '' });
  const [dateRange, setDateRange] = useState<DateRange>(rangeForPreset(DEFAULT_PRESET));

  useEffect(() => {
    const stored = loadStoredTimeRange();
    if (!stored) return;
    setPreset(stored.preset);
    const resolved = stored.preset === 'custom' && stored.startDate && stored.endDate
      ? { startDate: stored.startDate, endDate: stored.endDate }
      : rangeForPreset(stored.preset);
    if (stored.preset === 'custom' && stored.startDate && stored.endDate) {
      setCustomRange(resolved);
    }
    // A stored preset that resolves to the same range as the current
    // (default) one — e.g. the stored preset is 'all', matching
    // DEFAULT_PRESET — must not call setDateRange: doing so unconditionally
    // hands consumers keyed on `[dateRange]` a new object with the same
    // values, triggering a second, redundant fetch on every mount.
    if (resolved.startDate === dateRange.startDate && resolved.endDate === dateRange.endDate) return;
    setDateRange(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: reads dateRange's initial value to skip a same-value update, not to react to later changes.
  }, []);

  const handleChange = useCallback((next: Preset, range: DateRange, custom: DateRange) => {
    setPreset(next);
    setCustomRange(custom);
    setDateRange(range);
  }, []);

  return { preset, customRange, dateRange, handleChange };
}
