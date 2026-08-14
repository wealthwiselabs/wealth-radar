'use client';

import { useCallback, useState } from 'react';
import PDFUploadZone from './PDFUploadZone';
import StatementImportReview from './investments/StatementImportReview';
import { transactionAccountLabel } from '@/lib/accountDisplay';
import type { PendingTransaction, Category } from '@/types';
import type { StatementPreview } from './PDFUploadZone';

interface ImportPanelProps {
  categories: Category[];
  /** Called after imported rows are saved, so the host can refresh its data. */
  onImported: () => void | Promise<void>;
  /** Rendered above the upload zone — lets the host slot in Connect-a-bank. */
  children?: React.ReactNode;
}

/**
 * Statement import: upload PDFs, review what Claude classified, then commit.
 * Owns the whole pending-review lifecycle so neither page has to thread that
 * state through — the upload and the review of its output belong together.
 */
export default function ImportPanel({ categories, onImported, children }: ImportPanelProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[] | null>(null);
  const [statementPreviews, setStatementPreviews] = useState<StatementPreview[] | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'info'; text: string } | null>(null);

  const handleTransactionsClassified = useCallback((newTransactions: PendingTransaction[]) => {
    setPendingTransactions(newTransactions);
  }, []);

  const savePendingTransactions = async () => {
    if (!pendingTransactions) return;
    try {
      setIsProcessing(true);
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: pendingTransactions }),
      });
      if (res.ok) {
        const data = await res.json();
        setPendingTransactions(null);
        await onImported();
        if (data.skipped > 0) setStatusMessage({ type: 'info', text: data.message });
        else if (data.transactions.length > 0) setStatusMessage({ type: 'success', text: data.message });
        setTimeout(() => setStatusMessage(null), 5000);
      }
    } catch (error) {
      console.error('Error saving transactions:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const cancelPendingTransactions = () => setPendingTransactions(null);

  const handleUpdatePendingCategory = (index: number, categoryId: string) => {
    if (!pendingTransactions) return;
    const cat = categories.find((c) => c.id === categoryId);
    const firstSubcategoryId = cat?.subcategories[0]?.id || '';
    setPendingTransactions((prev) =>
      prev?.map((t, i) => (i === index ? { ...t, categoryId, subcategoryId: firstSubcategoryId } : t)) || null,
    );
  };

  const handleUpdatePendingSubcategory = (index: number, subcategoryId: string) => {
    if (!pendingTransactions) return;
    setPendingTransactions((prev) =>
      prev?.map((t, i) => (i === index ? { ...t, subcategoryId } : t)) || null,
    );
  };

  return (
    <div>
      {/* Status Message */}
      {statusMessage && (
        <div
          className={`mb-[var(--space-4)] p-[var(--space-3)] rounded-[var(--radius-2)] flex items-center justify-between ${
            statusMessage.type === 'info'
              ? 'bg-[var(--color-background-info-subdued)] border border-[var(--color-border-focus)]'
              : 'bg-[var(--color-background-success-subdued)] border border-[var(--color-border-success)]'
          }`}
        >
          <span className="text-small text-[var(--color-text-base-default)]">
            {statusMessage.text}
          </span>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-[var(--color-text-base-subdued)] hover:text-[var(--color-text-base-default)]"
          >
            &times;
          </button>
        </div>
      )}

      {children}

      <div className="mb-[var(--space-8)]">
        <PDFUploadZone
          onTransactionsClassified={handleTransactionsClassified}
          onStatementsPreviewed={(previews) => setStatementPreviews(previews)}
          isProcessing={isProcessing}
          setIsProcessing={setIsProcessing}
        />
      </div>

      {/* Pending Transactions Review */}
      {pendingTransactions && (
        <div className="mb-[var(--space-8)] p-[var(--space-6)] bg-[var(--color-background-info-subdued)] border border-[var(--color-border-focus)] rounded-[var(--radius-3)]">
          <div className="flex items-center justify-between mb-[var(--space-4)]">
            <div>
              <h2 className="heading-xsmall text-[var(--color-text-base-default)]">
                Review Imported Transactions
              </h2>
              <p className="text-small text-[var(--color-text-base-subdued)]">
                {pendingTransactions.length} transactions from{' '}
                {new Set(pendingTransactions.map((t) => t.source)).size} file(s)
              </p>
            </div>
            <div className="flex gap-[var(--space-3)]">
              <button
                onClick={cancelPendingTransactions}
                className="origin-btn origin-btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={savePendingTransactions}
                disabled={isProcessing}
                className="origin-btn origin-btn-primary"
              >
                {isProcessing ? 'Saving...' : 'Save All'}
              </button>
            </div>
          </div>

          <div className="origin-card overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-small">
                <thead className="bg-[var(--color-background-base-subdued)] sticky top-0">
                  <tr>
                    <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                      Date
                    </th>
                    <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                      Description
                    </th>
                    <th className="text-right py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                      Amount
                    </th>
                    <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                      Category
                    </th>
                    <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                      Subcategory
                    </th>
                    <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                      Source
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pendingTransactions.map((t, i) => {
                    const cat = categories.find((c) => c.id === t.categoryId);

                    return (
                      <tr
                        key={i}
                        className="border-t border-[var(--color-border-base-subdued)]"
                      >
                        <td className="py-[var(--space-2)] px-[var(--space-3)] text-[var(--color-text-base-subdued)] whitespace-nowrap">
                          {t.date}
                        </td>
                        <td className="py-[var(--space-2)] px-[var(--space-3)] text-[var(--color-text-base-default)]">
                          <div className="truncate max-w-xs">{t.description}</div>
                        </td>
                        <td
                          className={`py-[var(--space-2)] px-[var(--space-3)] text-right font-medium whitespace-nowrap ${
                            t.categoryId === 'transfer'
                              ? 'text-[var(--color-text-base-subdued)]'
                              : t.amount < 0
                                ? 'text-[var(--color-text-critical)]'
                                : 'text-[var(--color-text-success)]'
                          }`}
                        >
                          {t.amount < 0 ? '-' : '+'}$
                          {Math.abs(t.amount).toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                          })}
                        </td>
                        <td className="py-[var(--space-2)] px-[var(--space-3)] min-w-[140px]">
                          <select
                            value={t.categoryId}
                            onChange={(e) =>
                              handleUpdatePendingCategory(i, e.target.value)
                            }
                            className="origin-select w-full"
                            style={{
                              borderLeftWidth: '3px',
                              borderLeftColor: cat?.color || '#ccc',
                            }}
                          >
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-[var(--space-2)] px-[var(--space-3)] min-w-[160px]">
                          <select
                            value={t.subcategoryId}
                            onChange={(e) =>
                              handleUpdatePendingSubcategory(i, e.target.value)
                            }
                            className="origin-select w-full"
                          >
                            {cat?.subcategories.map((sub) => (
                              <option key={sub.id} value={sub.id}>
                                {sub.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td
                          className="py-[var(--space-2)] px-[var(--space-3)] text-[var(--color-text-base-subdued)] text-xsmall"
                          title={`${t.source} · ${transactionAccountLabel(t)}`}
                        >
                          <div className="truncate max-w-[160px]">{t.source}</div>
                          <div className="truncate max-w-[160px] text-[var(--color-text-base-disabled)]">
                            {transactionAccountLabel(t)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {statementPreviews && statementPreviews.length > 0 && (
        <StatementImportReview
          previews={statementPreviews}
          onCommitted={onImported}
          onCancel={() => setStatementPreviews(null)}
        />
      )}
    </div>
  );
}
