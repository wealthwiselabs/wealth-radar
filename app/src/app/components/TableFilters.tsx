'use client';

import { useMemo } from 'react';
import type { Category } from '@/types';

export interface TableFilterState {
  categoryId: string;
  subcategoryId: string;
  // Optional drill-down month set by chart click (YYYY-MM).
  month?: string;
}

interface Props {
  categories: Category[];
  filters: TableFilterState;
  resultCount: number;
  onChange: (filters: TableFilterState) => void;
  search: string;
  onSearchChange: (search: string) => void;
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

export default function TableFilters({
  categories,
  filters,
  resultCount,
  onChange,
  search,
  onSearchChange,
}: Props) {
  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === filters.categoryId),
    [categories, filters.categoryId]
  );

  const hasFilter = !!(filters.categoryId || filters.subcategoryId || filters.month);

  return (
    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
      <span className="text-small text-[var(--color-text-base-subdued)]">Filter</span>

      <select
        value={filters.categoryId}
        onChange={(e) =>
          onChange({ ...filters, categoryId: e.target.value, subcategoryId: '' })
        }
        className="origin-select"
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        value={filters.subcategoryId}
        onChange={(e) => onChange({ ...filters, subcategoryId: e.target.value })}
        className="origin-select"
        disabled={!filters.categoryId}
      >
        <option value="">All subcategories</option>
        {selectedCategory?.subcategories.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      {filters.month && (
        <span
          className="text-small px-[var(--space-2)] py-[var(--space-1)] bg-[var(--color-background-info-subdued)] border border-[var(--color-border-focus)] rounded-[var(--radius-1)] flex items-center gap-[var(--space-1)]"
          title="Set by clicking a chart segment"
        >
          {formatMonthLabel(filters.month)}
          <button
            onClick={() => onChange({ ...filters, month: undefined })}
            className="text-[var(--color-text-base-subdued)] hover:text-[var(--color-text-base-default)] leading-none"
            aria-label="Clear month filter"
          >
            &times;
          </button>
        </span>
      )}

      {hasFilter && (
        <button
          onClick={() => onChange({ categoryId: '', subcategoryId: '' })}
          className="origin-btn origin-btn-secondary"
        >
          Clear filters
        </button>
      )}

      {/* Keyword search, to the right of the filters. Searches only within the
          rows the time-range + category filters have already narrowed to. */}
      <div className="relative ml-auto">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search transactions"
          aria-label="Search transactions"
          className="origin-input w-[16rem] max-w-full pr-[var(--space-6)]"
        />
        {search && (
          <button
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
            className="absolute right-[var(--space-2)] top-1/2 -translate-y-1/2 text-[var(--color-text-base-subdued)] hover:text-[var(--color-text-base-default)] leading-none"
          >
            &times;
          </button>
        )}
      </div>

      <span className="text-small text-[var(--color-text-base-subdued)]">
        {resultCount} transaction{resultCount === 1 ? '' : 's'}
      </span>
    </div>
  );
}
