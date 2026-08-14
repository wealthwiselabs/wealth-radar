'use client';

import type { DateRange } from '@/types';
import {
  PRESET_LABELS,
  PRESET_ORDER,
  type Preset,
  rangeForPreset,
  saveStoredTimeRange,
} from '@/lib/timeRange';

interface Props {
  preset: Preset;
  customRange: DateRange;
  onChange: (preset: Preset, range: DateRange, customRange: DateRange) => void;
}

export default function TimeRangeDropdown({ preset, customRange, onChange }: Props) {
  const showCustom = preset === 'custom';

  const handlePresetChange = (newPreset: Preset) => {
    const range = rangeForPreset(newPreset, customRange);
    saveStoredTimeRange({
      preset: newPreset,
      startDate: newPreset === 'custom' ? customRange.startDate : undefined,
      endDate: newPreset === 'custom' ? customRange.endDate : undefined,
    });
    onChange(newPreset, range, customRange);
  };

  const handleCustomDateChange = (field: 'startDate' | 'endDate', value: string) => {
    const updated = { ...customRange, [field]: value };
    saveStoredTimeRange({
      preset: 'custom',
      startDate: updated.startDate,
      endDate: updated.endDate,
    });
    onChange('custom', updated, updated);
  };

  return (
    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
      <span className="text-small text-[var(--color-text-base-subdued)]">Time range</span>
      <select
        value={preset}
        onChange={(e) => handlePresetChange(e.target.value as Preset)}
        className="origin-select"
      >
        {PRESET_ORDER.map((p) => (
          <option key={p} value={p}>
            {PRESET_LABELS[p]}
          </option>
        ))}
      </select>
      {showCustom && (
        <>
          <input
            type="date"
            value={customRange.startDate}
            onChange={(e) => handleCustomDateChange('startDate', e.target.value)}
            className="origin-input"
          />
          <span className="text-small text-[var(--color-text-base-subdued)]">to</span>
          <input
            type="date"
            value={customRange.endDate}
            onChange={(e) => handleCustomDateChange('endDate', e.target.value)}
            className="origin-input"
          />
        </>
      )}
    </div>
  );
}
