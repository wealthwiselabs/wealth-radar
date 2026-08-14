'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import type { Transaction, Category } from '@/types';
import { transactionAccountLabel } from '@/lib/accountDisplay';
import {
  sortTransactions, nextSort, DEFAULT_SORT,
  type SortKey, type SortState,
} from '@/lib/transactionSort';
import RulePreviewModal from './RulePreviewModal';

/** Rows rendered before "Load more"; also the increment each click adds. */
const PAGE_SIZE = 50;

interface TransactionsTableProps {
  transactions: Transaction[];
  categories: Category[];
  onUpdate: (id: string, categoryId: string, subcategoryId: string) => void;
  onUpdateNote: (id: string, note: string) => void;
  onDelete: (id: string) => void;
}

export default function TransactionsTable({
  transactions,
  categories,
  onUpdate,
  onUpdateNote,
  onDelete,
}: TransactionsTableProps) {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteValue, setNoteValue] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [rulePrompt, setRulePrompt] = useState<{
    description: string; categoryId: string; subcategoryId: string; categoryLabel: string;
  } | null>(null);

  // A new filter or time range makes the current window meaningless, so start
  // again from the top. Re-sorting deliberately does NOT reset it — collapsing
  // 300 rows back to 50 because you changed the order would be infuriating.
  useEffect(() => setVisibleCount(PAGE_SIZE), [transactions]);

  // Create a map for quick category/subcategory lookup
  const categoryMap = useMemo(() => {
    const map: Record<string, { category: Category; subcategoryMap: Record<string, string> }> = {};
    categories.forEach((cat) => {
      const subcategoryMap: Record<string, string> = {};
      cat.subcategories.forEach((sub) => {
        subcategoryMap[sub.id] = sub.name;
      });
      map[cat.id] = { category: cat, subcategoryMap };
    });
    return map;
  }, [categories]);

  // Sort the WHOLE filtered set, then slice. Sorting the visible page instead
  // would reorder within it and never surface the largest amount in the data.
  const sortedTransactions = useMemo(
    () => sortTransactions(transactions, sort, {
      category: (t) => categoryMap[t.categoryId]?.category.name ?? t.categoryId,
      subcategory: (t) => categoryMap[t.categoryId]?.subcategoryMap[t.subcategoryId] ?? t.subcategoryId,
    }),
    [transactions, sort, categoryMap],
  );
  const visibleTransactions = sortedTransactions.slice(0, visibleCount);
  const hasMore = sortedTransactions.length > visibleTransactions.length;

  const SortableHeader = ({ label, sortKey, align = 'left' }: {
    label: string; sortKey: SortKey; align?: 'left' | 'right';
  }) => {
    const active = sort.key === sortKey;
    return (
      <th
        className={`text-${align} py-[var(--space-3)] px-[var(--space-2)] font-medium text-[var(--color-text-base-subdued)]`}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button
          type="button"
          onClick={() => setSort((s) => nextSort(s, sortKey))}
          className="inline-flex items-center gap-[var(--space-1)] font-medium hover:text-[var(--color-text-base-default)]"
          style={{ color: active ? 'var(--color-text-base-default)' : undefined }}
        >
          {label}
          <span aria-hidden="true" className="text-xsmall">
            {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </button>
      </th>
    );
  };

  const labelFor = (categoryId: string, subcategoryId: string) => {
    const cat = categoryMap[categoryId];
    if (!cat) return `${categoryId} > ${subcategoryId}`;
    return `${cat.category.name} > ${cat.subcategoryMap[subcategoryId] ?? subcategoryId}`;
  };

  // Pending rule-prompt debounce state. A ref (not state) because it's
  // read/written from a setTimeout callback and must never trigger its own
  // render.
  const rulePromptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRuleRef = useRef<{
    transaction: Transaction; categoryId: string; subcategoryId: string;
  } | null>(null);

  // The edit itself always lands immediately (that part is correct and other
  // code depends on it) — only the rule prompt is debounced, by 2s.
  //
  // Why debounce instead of prompting on every change: recategorizing a row
  // is often a two-step gesture. Picking a category snaps its subcategory to
  // that category's FIRST entry as a placeholder, which is frequently not
  // the right one — e.g. picking "Education" on a Kindle row lands on
  // education > tuition, not books. Prompting right there would offer a rule
  // for "category > first subcategory," a pairing the user never actually
  // chose, one reflexive click from rewriting a pile of unrelated
  // transactions to Tuition. So instead of prompting per-change, every
  // category/subcategory change (re)schedules a single prompt 2s out,
  // describing whatever pair is current *at the moment it fires* — not
  // whatever was current when the timer started. A same-row follow-up
  // (category, then subcategory) cancels and replaces the pending prompt
  // rather than queueing a second one, so "Education" (-> tuition) then
  // "Books" produces exactly one prompt, for Education > Books. A change to
  // a different row replaces it too — the user has moved on, so a prompt for
  // the abandoned row would be describing a correction nobody asked about
  // anymore. And if a prompt is already open on screen, a newly-fired one
  // never stacks on top of it.
  const scheduleRulePrompt = (
    transaction: Transaction,
    categoryId: string,
    subcategoryId: string,
  ) => {
    pendingRuleRef.current = { transaction, categoryId, subcategoryId };
    if (rulePromptTimeoutRef.current !== null) {
      clearTimeout(rulePromptTimeoutRef.current);
    }
    rulePromptTimeoutRef.current = setTimeout(() => {
      rulePromptTimeoutRef.current = null;
      const pending = pendingRuleRef.current;
      pendingRuleRef.current = null;
      if (!pending) return;
      setRulePrompt((prev) => prev ?? {
        description: pending.transaction.description,
        categoryId: pending.categoryId,
        subcategoryId: pending.subcategoryId,
        categoryLabel: labelFor(pending.categoryId, pending.subcategoryId),
      });
    }, 2000);
  };

  // Cancel any in-flight debounce on unmount so a prompt can never fire (and
  // setState) after this component is gone.
  useEffect(() => () => {
    if (rulePromptTimeoutRef.current !== null) {
      clearTimeout(rulePromptTimeoutRef.current);
    }
  }, []);

  const handleCategoryChange = (
    transaction: Transaction,
    newCategoryId: string
  ) => {
    const cat = categoryMap[newCategoryId];
    if (cat) {
      const firstSub = cat.category.subcategories[0]?.id || '';
      onUpdate(transaction.id, newCategoryId, firstSub);
      scheduleRulePrompt(transaction, newCategoryId, firstSub);
    }
  };

  const handleSubcategoryChange = (
    transaction: Transaction,
    newSubcategoryId: string
  ) => {
    onUpdate(transaction.id, transaction.categoryId, newSubcategoryId);
    scheduleRulePrompt(transaction, transaction.categoryId, newSubcategoryId);
  };

  const startEditingNote = (transaction: Transaction) => {
    setEditingNoteId(transaction.id);
    setNoteValue(transaction.note);
  };

  const saveNote = (id: string) => {
    onUpdateNote(id, noteValue);
    setEditingNoteId(null);
    setNoteValue('');
  };

  const cancelEditingNote = () => {
    setEditingNoteId(null);
    setNoteValue('');
  };

  const formatAmount = (amount: number) => {
    const formatted = Math.abs(amount).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
    return amount < 0 ? `-${formatted}` : `+${formatted}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // The rule prompt can outlive the correction it followed from — e.g. the
  // table's own filters hide the just-recategorized row, or it was the last
  // row left in view. Render the modal regardless of which branch below fires
  // so an in-flight prompt is never yanked out from under the user.
  const rulePromptModal = rulePrompt && (
    <RulePreviewModal
      description={rulePrompt.description}
      categoryId={rulePrompt.categoryId}
      subcategoryId={rulePrompt.subcategoryId}
      categories={categories}
      onClose={() => setRulePrompt(null)}
    />
  );

  if (transactions.length === 0) {
    return (
      <>
        <div className="text-center py-[var(--space-12)] text-[var(--color-text-base-subdued)]">
          <svg
            className="w-16 h-16 mx-auto mb-[var(--space-4)] text-[var(--color-icon-base-subdued)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <p className="text-large">No transactions yet</p>
          <p className="text-small mt-[var(--space-1)]">Upload a bank statement PDF to get started</p>
        </div>
        {rulePromptModal}
      </>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-small">
        <thead>
          <tr className="border-b border-[var(--color-border-base-default)]">
            <SortableHeader label="Date" sortKey="date" />
            <th className="text-left py-[var(--space-3)] px-[var(--space-2)] font-medium text-[var(--color-text-base-subdued)]">
              Description
            </th>
            <SortableHeader label="Amount" sortKey="amount" align="right" />
            <SortableHeader label="Category" sortKey="category" />
            <SortableHeader label="Subcategory" sortKey="subcategory" />
            <th className="text-left py-[var(--space-3)] px-[var(--space-2)] font-medium text-[var(--color-text-base-subdued)]">
              Note
            </th>
            <th className="text-center py-[var(--space-3)] px-[var(--space-2)] font-medium text-[var(--color-text-base-subdued)] w-10">

            </th>
          </tr>
        </thead>
        <tbody>
          {visibleTransactions.map((transaction) => {
            const cat = categoryMap[transaction.categoryId];

            return (
              <tr
                key={transaction.id}
                className="border-b border-[var(--color-border-base-subdued)] hover:bg-[var(--color-background-base-hover)]"
              >
                <td className="py-[var(--space-3)] px-[var(--space-2)] whitespace-nowrap text-[var(--color-text-base-subdued)]">
                  {formatDate(transaction.date)}
                </td>
                <td className="py-[var(--space-3)] px-[var(--space-2)]">
                  {/* The cell truncates, so the full text has to stay reachable
                      somewhere. A native title needs no JS and is what screen
                      readers and touch long-press already expect. */}
                  <div
                    className="max-w-xs truncate text-[var(--color-text-base-default)]"
                    title={transaction.description}
                  >
                    {transaction.description}
                  </div>
                  <div className="text-xsmall text-[var(--color-text-base-disabled)]">
                    {transactionAccountLabel(transaction)}
                  </div>
                </td>
                <td
                  className={`py-[var(--space-3)] px-[var(--space-2)] text-right whitespace-nowrap font-medium ${
                    transaction.categoryId === 'transfer'
                      ? 'text-[var(--color-text-base-subdued)]'
                      : transaction.amount < 0
                        ? 'text-[var(--color-text-critical)]'
                        : 'text-[var(--color-text-success)]'
                  }`}
                >
                  {formatAmount(transaction.amount)}
                </td>
                <td className="py-[var(--space-3)] px-[var(--space-2)] min-w-[140px]">
                  <select
                    value={transaction.categoryId}
                    onChange={(e) =>
                      handleCategoryChange(transaction, e.target.value)
                    }
                    className="origin-select w-full"
                    style={{
                      borderLeftWidth: '3px',
                      borderLeftColor: cat?.category.color || '#ccc',
                    }}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-[var(--space-3)] px-[var(--space-2)] min-w-[160px]">
                  <select
                    value={transaction.subcategoryId}
                    onChange={(e) =>
                      handleSubcategoryChange(transaction, e.target.value)
                    }
                    className="origin-select w-full"
                  >
                    {cat?.category.subcategories.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-[var(--space-3)] px-[var(--space-2)]">
                  {editingNoteId === transaction.id ? (
                    <div className="flex gap-[var(--space-1)]">
                      <input
                        type="text"
                        value={noteValue}
                        onChange={(e) => setNoteValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveNote(transaction.id);
                          if (e.key === 'Escape') cancelEditingNote();
                        }}
                        className="origin-input flex-1"
                        autoFocus
                      />
                      <button
                        onClick={() => saveNote(transaction.id)}
                        className="p-[var(--space-1)] text-[var(--color-text-success)] hover:bg-[var(--color-background-success-subdued)] rounded-[var(--radius-1)]"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                      <button
                        onClick={cancelEditingNote}
                        className="p-[var(--space-1)] text-[var(--color-icon-base-default)] hover:bg-[var(--color-background-base-hover)] rounded-[var(--radius-1)]"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEditingNote(transaction)}
                      className="w-full text-left px-[var(--space-2)] py-[var(--space-1)] text-small text-[var(--color-text-base-subdued)] hover:bg-[var(--color-background-base-hover)] rounded-[var(--radius-1)] truncate"
                    >
                      {transaction.note || 'Add note...'}
                    </button>
                  )}
                </td>
                <td className="py-[var(--space-3)] px-[var(--space-2)] text-center">
                  <button
                    onClick={() => onDelete(transaction.id)}
                    className="p-[var(--space-1)] text-[var(--color-icon-base-subdued)] hover:text-[var(--color-icon-critical)] hover:bg-[var(--color-background-critical-subdued)] rounded-[var(--radius-1)]"
                    title="Delete transaction"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {(hasMore || sortedTransactions.length > PAGE_SIZE) && (
        <div className="flex items-center justify-center gap-[var(--space-3)] py-[var(--space-4)]">
          <span className="text-small text-[var(--color-text-base-subdued)]">
            Showing {visibleTransactions.length} of {sortedTransactions.length}
          </span>
          {hasMore && (
            <button
              onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
              className="origin-btn origin-btn-secondary"
            >
              Load more
            </button>
          )}
        </div>
      )}

      {rulePromptModal}
    </div>
  );
}
