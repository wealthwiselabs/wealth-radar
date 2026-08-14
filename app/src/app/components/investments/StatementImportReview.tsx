'use client';

import { useState } from 'react';
import { formatCurrency } from '@/lib/chartConfig';
import type { StatementPreview } from '../PDFUploadZone';
import type { CommitResult } from '@/lib/investments/statementBackfill';

/**
 * Preview → confirm for uploaded investment statements. Shows the planned effect
 * of each statement (account touched/created, reconcile + flow + supersede
 * counts) and only writes to the DB when the user confirms.
 */
export default function StatementImportReview({
  previews, onCommitted, onCancel,
}: { previews: StatementPreview[]; onCommitted: () => void | Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CommitResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statements = previews.flatMap((p) => p.statements);
  const plan = previews.flatMap((p) => p.plan);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/investments/import-statement/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statements }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || `Import failed (${res.status})`); return; }
      setResults(data.results as CommitResult[]);
      await onCommitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  if (results) {
    const created = results.filter((r) => r.created).length;
    const superseded = results.reduce((s, r) => s + r.superseded, 0);
    return (
      <div className="mb-[var(--space-8)] p-[var(--space-6)] bg-[var(--color-background-success-subdued)] border border-[var(--color-border-success)] rounded-[var(--radius-3)]">
        <h2 className="heading-xsmall text-[var(--color-text-base-default)]">Investment statements imported</h2>
        <p className="text-small text-[var(--color-text-base-subdued)] mt-[var(--space-1)]">
          {results.length} account snapshot(s) written · {created} new account(s) · {superseded} Plaid flow(s) superseded
        </p>
        <ul className="mt-[var(--space-3)] text-small">
          {results.map((r, i) => (
            <li key={i} className="text-[var(--color-text-base-default)]">
              {r.institution} · {r.mask ?? r.planName ?? '—'} @ {r.asOf}
              {r.created ? ' (created)' : ''}{!r.reconciled ? ' — value-authoritative (holdings mismatch)' : ''}
            </li>
          ))}
        </ul>
        <button type="button" onClick={onCancel} className="origin-btn origin-btn-secondary mt-[var(--space-4)]">Done</button>
      </div>
    );
  }

  return (
    <div className="mb-[var(--space-8)] p-[var(--space-6)] bg-[var(--color-background-info-subdued)] border border-[var(--color-border-focus)] rounded-[var(--radius-3)]">
      <div className="flex items-center justify-between mb-[var(--space-4)]">
        <div>
          <h2 className="heading-xsmall text-[var(--color-text-base-default)]">Review investment statements</h2>
          <p className="text-small text-[var(--color-text-base-subdued)]">
            {plan.length} account(s) across {previews.length} file(s). Nothing is saved until you confirm.
          </p>
        </div>
        <div className="flex gap-[var(--space-3)]">
          <button type="button" onClick={onCancel} disabled={busy} className="origin-btn origin-btn-secondary">Cancel</button>
          <button type="button" onClick={confirm} disabled={busy} className="origin-btn origin-btn-primary">
            {busy ? 'Importing…' : 'Confirm import'}
          </button>
        </div>
      </div>

      <div className="origin-card overflow-hidden">
        <table className="w-full text-small">
          <thead className="bg-[var(--color-background-base-subdued)]">
            <tr>
              {['Account', 'As of', 'Reported total', 'Holdings', 'Flows', 'Plaid superseded'].map((h) => (
                <th key={h} className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.map((e, i) => (
              <tr key={i} className="border-t border-[var(--color-border-base-subdued)]">
                <td className="py-[var(--space-2)] px-[var(--space-3)] text-[var(--color-text-base-default)]">
                  {e.institution} · {e.mask ?? e.planName ?? '—'}
                  {e.willCreateAccount
                    ? <span className="ml-[var(--space-2)] text-xsmall text-[var(--color-text-warning)]">will create</span>
                    : <span className="ml-[var(--space-2)] text-xsmall text-[var(--color-text-base-subdued)]">{e.existingAccountName}</span>}
                </td>
                <td className="py-[var(--space-2)] px-[var(--space-3)] text-[var(--color-text-base-subdued)] whitespace-nowrap">{e.asOf}</td>
                <td className="py-[var(--space-2)] px-[var(--space-3)] text-right whitespace-nowrap">{formatCurrency(e.reportedTotal)}</td>
                <td className="py-[var(--space-2)] px-[var(--space-3)]">
                  {e.holdingsReconciled
                    ? <span className="text-[var(--color-text-success)]">reconciled</span>
                    : <span className="text-[var(--color-text-warning)]">mismatch</span>}
                </td>
                <td className="py-[var(--space-2)] px-[var(--space-3)] text-right">{e.flowCount}</td>
                <td className="py-[var(--space-2)] px-[var(--space-3)] text-right">{e.plaidFlowsToSupersede}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <div className="mt-[var(--space-4)] p-[var(--space-3)] bg-[var(--color-background-critical-subdued)] border border-[var(--color-border-critical)] rounded-[var(--radius-2)]">
          <p className="text-small text-[var(--color-text-critical)]">{error}</p>
        </div>
      )}
    </div>
  );
}
