'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import TransactionsTable from './components/TransactionsTable';
import TimeRangeDropdown from './components/TimeRangeDropdown';
import SyncButton from './components/SyncButton';
import TableFilters, { type TableFilterState } from './components/TableFilters';
import ExportButton from './components/ExportButton';
import MonthlyExpensesChart from './components/charts/MonthlyExpensesChart';
import CategoryTotalsChart from './components/charts/CategoryTotalsChart';
import FinancialHealthChart from './components/charts/FinancialHealthChart';
import TrailingAverageLabel from './components/TrailingAverageLabel';
import { useAppConfig } from './hooks/useAppConfig';
import { useTimeRange } from './hooks/useTimeRange';
import type { Preset } from '@/lib/timeRange';
import type { Transaction, Category, DateRange } from '@/types';
import { sumExpenses, sumIncome } from '@/lib/spending';
import { searchTransactions } from '@/lib/transactionSearch';
import { onDataChanged, notifyDataChanged } from '@/lib/dataEvents';
import { useRefreshOnFocus } from './hooks/useRefreshOnFocus';

export default function Home() {
  const config = useAppConfig();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const { preset, customRange, dateRange, handleChange } = useTimeRange();
  const [tableFilters, setTableFilters] = useState<TableFilterState>({
    categoryId: '',
    subcategoryId: '',
  });
  // Kept separate from tableFilters so chart drill-downs and "Clear filters"
  // don't wipe an in-progress search.
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  // Bumped after sync / account changes / new statements so the coverage grid + gaps badge refetch.

  const handleTimeRangeChange = useCallback(
    (newPreset: Preset, range: DateRange, custom: DateRange) => {
      handleChange(newPreset, range, custom);
      // Time scope changed — drop any drill-down month (likely outside the new window).
      setTableFilters((f) => ({ ...f, month: undefined }));
    },
    [handleChange]
  );

  const handleMonthlyChartClick = useCallback(
    (click: { month: string; categoryId?: string }) => {
      setTableFilters((prev) => ({
        categoryId: click.categoryId ?? prev.categoryId,
        // New category context → reset subcategory.
        subcategoryId: click.categoryId ? '' : prev.subcategoryId,
        month: click.month,
      }));
      // Smooth scroll the table into view so the drill-down is visible.
      if (typeof window !== 'undefined') {
        document.getElementById('transactions-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    []
  );

  const handleCategoryChartClick = useCallback(
    (click: { categoryId: string; subcategoryId?: string }) => {
      setTableFilters((prev) => ({
        ...prev,
        categoryId: click.categoryId,
        subcategoryId: click.subcategoryId ?? '',
      }));
      if (typeof window !== 'undefined') {
        document.getElementById('transactions-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    []
  );

  // Resolve category/subcategory IDs to their display names so search can match
  // what the reader sees in the table, not the opaque IDs.
  const searchLabels = useMemo(() => {
    const catName = new Map<string, string>();
    const subName = new Map<string, string>();
    for (const c of categories) {
      catName.set(c.id, c.name);
      for (const s of c.subcategories) subName.set(s.id, s.name);
    }
    return {
      category: (t: Transaction) => catName.get(t.categoryId) ?? '',
      subcategory: (t: Transaction) => subName.get(t.subcategoryId) ?? '',
    };
  }, [categories]);

  // Apply table-only filters (cat/subcat/drill-month) on top of the API-fetched
  // window, then the keyword search — so search only ever narrows what the
  // time-range and category filters have already scoped.
  const visibleTransactions = useMemo(() => {
    let out = transactions;
    if (tableFilters.month) {
      out = out.filter((t) => t.date.startsWith(tableFilters.month!));
    }
    if (tableFilters.categoryId) {
      out = out.filter((t) => t.categoryId === tableFilters.categoryId);
    }
    if (tableFilters.subcategoryId) {
      out = out.filter((t) => t.subcategoryId === tableFilters.subcategoryId);
    }
    out = searchTransactions(out, search, searchLabels);
    return out;
  }, [transactions, tableFilters, search, searchLabels]);

  // Fetch transactions and taxonomy on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch taxonomy
        const taxonomyRes = await fetch('/api/taxonomy');
        if (taxonomyRes.ok) {
          const taxonomy = await taxonomyRes.json();
          setCategories(taxonomy.categories);
        }

        // Fetch transactions
        const params = new URLSearchParams();
        if (dateRange.startDate) params.append('startDate', dateRange.startDate);
        if (dateRange.endDate) params.append('endDate', dateRange.endDate);

        const transRes = await fetch(`/api/transactions?${params}`);
        if (transRes.ok) {
          const data = await transRes.json();
          setTransactions(data.transactions);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [dateRange]);

  // Refresh transactions when date range changes. Also reused as the shared
  // "something changed" handler for sync / connect-a-bank / account edits, so
  // bump the coverage refresh key here to keep the grid + gaps badge in sync.
  const refreshTransactions = useCallback(async () => {
    const params = new URLSearchParams();
    if (dateRange.startDate) params.append('startDate', dateRange.startDate);
    if (dateRange.endDate) params.append('endDate', dateRange.endDate);

    // Both callers below fire this and walk away, so a rejection here has
    // nowhere to go — it surfaces as an unhandled rejection (the dev overlay's
    // "TypeError: Failed to fetch"). That is the normal case, not an exotic
    // one: this runs when the tab regains focus, which is exactly when the
    // machine has just woken or the dev server is mid-restart.
    //
    // Keep whatever is already on screen. This is a background refresh the
    // user did not ask for, so a transient blip must not blank the page —
    // stale rows beat empty ones, and the next focus or sync retries.
    try {
      const res = await fetch(`/api/transactions?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions);
      }
    } catch (error) {
      console.error('Error refreshing transactions:', error);
    }
  }, [dateRange]);

  // Sync lives in the header, which has no handle on this page's state — pick
  // up its completion (and imports/edits made on /accounts) via the broadcast.
  useEffect(() => onDataChanged(() => { refreshTransactions(); }), [refreshTransactions]);

  // Bridge for the server-side background sync: it can't reach an open tab,
  // so rerun the fetch when the user returns to this one.
  useRefreshOnFocus(refreshTransactions);

  // Update transaction category
  const handleUpdateTransaction = async (
    id: string,
    categoryId: string,
    subcategoryId: string
  ) => {
    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId, subcategoryId }),
      });

      if (res.ok) {
        const data = await res.json();
        setTransactions((prev) =>
          prev.map((t) => (t.id === id ? data.transaction : t))
        );
      }
    } catch (error) {
      console.error('Error updating transaction:', error);
    }
  };

  // Update transaction note
  const handleUpdateNote = async (id: string, note: string) => {
    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });

      if (res.ok) {
        const data = await res.json();
        setTransactions((prev) =>
          prev.map((t) => (t.id === id ? data.transaction : t))
        );
      }
    } catch (error) {
      console.error('Error updating note:', error);
    }
  };

  // Delete transaction
  const handleDeleteTransaction = async (id: string) => {
    if (!confirm('Are you sure you want to delete this transaction?')) return;

    try {
      const res = await fetch(`/api/transactions/${id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setTransactions((prev) => prev.filter((t) => t.id !== id));
      }
    } catch (error) {
      console.error('Error deleting transaction:', error);
    }
  };

  // Scope money totals + charts to spending accounts only (table keeps showing everything).
  const spendingTx = useMemo(
    () => transactions.filter((t) => t.accountClass === 'spending'),
    [transactions],
  );

  // Calculate summary stats
  // Same rule the charts use — summing every negative row here counted internal
  // transfers (card payments) as spending and disagreed with the chart below.
  const totalExpenses = sumExpenses(spendingTx);
  const totalIncome = sumIncome(spendingTx);

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[var(--color-background-brand-default)] border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen p-[var(--space-4)] md:p-[var(--space-8)] max-w-7xl mx-auto">


      {/* Scope + refresh, above the numbers they govern: the range control used
          to sit BELOW the summary cards it scopes, so the cards were filtered
          by something the reader had not seen yet. */}
      <div className="mb-[var(--space-4)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        {(transactions.length > 0 || dateRange.startDate || dateRange.endDate) ? (
          <TimeRangeDropdown
            preset={preset}
            customRange={customRange}
            onChange={handleTimeRangeChange}
          />
        ) : (
          <span />
        )}
        <SyncButton onSynced={notifyDataChanged} />
      </div>

      {/* Financial health: income, spending and investment return together,
          so a month the portfolio outearned spending is visible at a glance. */}
      {transactions.length > 0 && (
        <div className="origin-card-elevated p-[var(--space-6)] mb-[var(--space-8)]">
          <h3 className="heading-xsmall text-[var(--color-text-base-default)] mb-[var(--space-4)]">
            Income, spending &amp; investment return
          </h3>
          <FinancialHealthChart transactions={spendingTx} dateRange={dateRange} />
        </div>
      )}

      {/* Summary Stats */}
      {transactions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[var(--space-4)] mb-[var(--space-8)]">
          <div className="origin-card p-[var(--space-4)]">
            <p className="text-small text-[var(--color-text-base-subdued)]">
              Total Expenses
            </p>
            <p className="heading-medium text-[var(--color-text-critical)]">
              -${totalExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="origin-card p-[var(--space-4)]">
            <p className="text-small text-[var(--color-text-base-subdued)]">
              Total Income
            </p>
            <p className="heading-medium text-[var(--color-text-success)]">
              +${totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="origin-card p-[var(--space-4)]">
            <p className="text-small text-[var(--color-text-base-subdued)]">
              Net
            </p>
            <p
              className={`heading-medium ${
                totalIncome - totalExpenses >= 0
                  ? 'text-[var(--color-text-success)]'
                  : 'text-[var(--color-text-critical)]'
              }`}
            >
              {totalIncome - totalExpenses >= 0 ? '+' : '-'}$
              {Math.abs(totalIncome - totalExpenses).toLocaleString('en-US', {
                minimumFractionDigits: 2,
              })}
            </p>
          </div>
        </div>
      )}

      {/* Charts */}
      {transactions.length > 0 && (
        <div className="grid grid-cols-1 gap-[var(--space-6)] mb-[var(--space-8)]">
          <div className="origin-card-elevated p-[var(--space-6)]">
            <div className="mb-[var(--space-4)] flex flex-wrap items-baseline justify-between gap-x-[var(--space-3)] gap-y-[var(--space-1)]">
              <h3 className="heading-xsmall text-[var(--color-text-base-default)]">
                Monthly Expenses
              </h3>
              <TrailingAverageLabel transactions={spendingTx} />
            </div>
            <MonthlyExpensesChart
              transactions={spendingTx}
              categories={categories}
              onSegmentClick={handleMonthlyChartClick}
            />
          </div>
          <div className="origin-card-elevated p-[var(--space-6)]">
            <h3 className="heading-xsmall text-[var(--color-text-base-default)] mb-[var(--space-4)]">
              Spending by Category
            </h3>
            <CategoryTotalsChart
              transactions={spendingTx}
              categories={categories}
              onSegmentClick={handleCategoryChartClick}
            />
          </div>
        </div>
      )}


      {/* Table-only refinements + Export */}
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-4)] mb-[var(--space-4)]">
        <TableFilters
          categories={categories}
          filters={tableFilters}
          resultCount={visibleTransactions.length}
          onChange={setTableFilters}
          search={search}
          onSearchChange={setSearch}
        />
        {transactions.length > 0 && <ExportButton dateRange={dateRange} />}
      </div>

      {/* Transactions Table */}
      <div id="transactions-table" className="origin-card-elevated p-[var(--space-4)] scroll-mt-[var(--space-4)]">
        <h3 className="heading-xsmall text-[var(--color-text-base-default)] mb-[var(--space-4)]">
          Transactions ({visibleTransactions.length})
        </h3>
        <TransactionsTable
          transactions={visibleTransactions}
          categories={categories}
          onUpdate={handleUpdateTransaction}
          onUpdateNote={handleUpdateNote}
          onDelete={handleDeleteTransaction}
        />
      </div>
    </main>
  );
}
