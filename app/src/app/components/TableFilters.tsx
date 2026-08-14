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
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

export default function TableFilters({ categories, filters, resultCount, onChange }: Props) {
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

      <span className="text-small text-[var(--color-text-base-subdued)] ml-auto">
        {resultCount} transaction{resultCount === 1 ? '' : 's'}
      </span>
    </div>
  );
}
