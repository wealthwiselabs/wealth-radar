import { describe, it, expect, afterEach, vi } from 'vitest';
import { rangeForPreset, PRESET_ORDER, PRESET_LABELS } from '@/lib/timeRange';

// Fixed "today" so the month arithmetic is assertable.
const freeze = (iso: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
};
afterEach(() => vi.useRealTimers());

describe('rangeForPreset', () => {
  it('counts the current month as one of the N', () => {
    freeze('2026-07-15T12:00:00Z');
    expect(rangeForPreset('last-3-months')).toEqual({ startDate: '2026-05-01', endDate: '2026-07-31' });
    expect(rangeForPreset('last-6-months')).toEqual({ startDate: '2026-02-01', endDate: '2026-07-31' });
    expect(rangeForPreset('last-12-months')).toEqual({ startDate: '2025-08-01', endDate: '2026-07-31' });
  });

  it('rolls back across the year boundary', () => {
    freeze('2026-02-10T12:00:00Z');
    expect(rangeForPreset('last-6-months')).toEqual({ startDate: '2025-09-01', endDate: '2026-02-28' });
    expect(rangeForPreset('last-12-months')).toEqual({ startDate: '2025-03-01', endDate: '2026-02-28' });
  });

  it('lists every preset in the dropdown with a label', () => {
    for (const p of PRESET_ORDER) expect(PRESET_LABELS[p]).toBeTruthy();
    expect(PRESET_ORDER).toContain('last-6-months');
    expect(PRESET_ORDER).toContain('last-12-months');
  });
});
