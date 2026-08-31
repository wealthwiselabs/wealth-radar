'use client';

import { useState } from 'react';
import { formatCurrency, formatSignedCurrency } from '@/lib/chartConfig';
import { notifyDataChanged } from '@/lib/dataEvents';
import { monthsBetween } from '@/lib/netWorth/staleness';
import AddItemSheet from '@/app/components/netWorth/AddItemSheet';
import type { RegisterRow } from '@/app/net-worth/page';

function ageLabel(lastAsOf: string | null, interval: number | null): { text: string; stale: boolean } {
  if (!lastAsOf) return { text: 'never valued', stale: true };
  // Shares the server's exact month/day adjustment (staleness.ts) so a row
  // can never show the warning colour while StaleStrip disagrees, or vice versa.
  const today = new Date().toISOString().slice(0, 10);
  const months = monthsBetween(lastAsOf, today);
  const stale = interval !== null && months > interval;
  return { text: `as of ${lastAsOf}`, stale };
}

function Row({ row, onChanged }: { row: RegisterRow; onChanged: () => void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const age = ageLabel(row.lastAsOf, row.reviewIntervalMonths);

  async function commit() {
    const raw = draft;
    if (raw.trim() === '') return;
    const parsed = Number(raw.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(parsed)) {
      setError('Enter a valid number.');
      return;
    }
    if (parsed < 0) {
      // Balances are magnitudes; direction comes from the account's class.
      setError('Enter a positive amount — debts are entered as what you owe.');
      return;
    }
    setError(null);
    // Clear the draft synchronously, before the await. Setting `saving` below
    // makes the input `disabled`, which the browser turns into a synchronous
    // blur on this still-focused element — that re-fires onBlur's own
    // commit(). Clearing draft here first means that re-entrant call sees an
    // empty draft and no-ops, so one Enter can only ever produce one POST.
    // If the write fails, restore `raw` (captured above) below — a failed
    // save must not silently discard what the user typed. The restore always
    // happens after the await, by which time the re-entrant blur has already
    // fired and no-oped against the empty draft, so this can't reopen the
    // double-POST: nothing re-reads `draft` synchronously after this point.
    setDraft('');
    setSaving(true);
    try {
      const res = await fetch('/api/net-worth/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: row.accountId, balance: parsed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
        setDraft(raw);
        return;
      }
      notifyDataChanged();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setDraft(raw);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    // Two verbs, deliberately. Deleting an item that has recorded values would
    // rewrite past periods on the trend chart — "I sold my car" must not erase a
    // year of history. Once anything is recorded, the only removal is a close.
    const closing = !row.canDelete;
    const message = closing
      ? `Close ${row.name}? It stops counting from this month, and past months keep its value.`
      : `Delete ${row.name}? It has no recorded values, so nothing is lost.`;
    if (!window.confirm(message)) return;
    const res = closing
      ? await fetch(`/api/net-worth/accounts/${row.accountId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ closedAtMonth: new Date().toISOString().slice(0, 7) }),
        })
      : await fetch(`/api/net-worth/accounts/${row.accountId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === 'string' ? body.error : 'Could not remove the item.');
      return;
    }
    notifyDataChanged();
    onChanged();
  }

  return (
    <div className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]">
      <div>
        <p className="text-small text-[var(--color-text-base-default)]">{row.name}</p>
        <p
          className="text-xsmall"
          style={{ color: age.stale ? 'var(--color-text-warning)' : 'var(--color-text-base-subdued)' }}
        >
          {age.text}
          {row.source === 'estimate' ? ' · estimate' : ''}
        </p>
        {error && <p className="text-xsmall text-[var(--color-text-critical)]">{error}</p>}
      </div>
      <div className="flex items-center gap-[var(--space-2)]">
        {/* An unvalued item is an em dash, never $0. The difference is the point. */}
        <span className="text-small text-[var(--color-text-base-default)] tabular-nums">
          {row.value === null ? '—' : formatCurrency(row.value)}
        </span>
        <input
          aria-label={`Value for ${row.name}`}
          className="origin-input w-28"
          inputMode="decimal"
          placeholder="update"
          value={draft}
          disabled={saving}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void commit(); }}
          onBlur={() => { if (draft.trim() !== '') void commit(); }}
        />
        <button
          type="button"
          className="origin-btn origin-btn-secondary"
          aria-label={`Remove ${row.name}`}
          onClick={() => { void remove(); }}
        >
          {row.canDelete ? 'Delete' : 'Close'}
        </button>
      </div>
    </div>
  );
}

/**
 * The debt secured against one asset, and what is left over.
 *
 * Rendered as a sub-line under the asset rather than as its own row: an $800k
 * house against a $500k mortgage must not read like an $800k asset. The
 * liability still appears in full in the Liabilities column — this is a nesting
 * for legibility, not a second copy, so nothing is double-counted.
 */
function SecuredUnder({ asset, allRows }: { asset: RegisterRow; allRows: RegisterRow[] }) {
  const secured = allRows.filter((r) => r.securedByAccountId === asset.accountId && r.value !== null);
  if (secured.length === 0 || asset.value === null) return null;
  const debt = secured.reduce((sum, r) => sum + (r.value ?? 0), 0);
  return (
    <div className="pl-[var(--space-4)] pb-[var(--space-2)]">
      {secured.map((r) => (
        <p key={r.accountId} className="text-xsmall text-[var(--color-text-base-subdued)]">
          less {r.name} {formatCurrency(r.value ?? 0)}
        </p>
      ))}
      <p className="text-xsmall text-[var(--color-text-base-default)]">
        equity <span data-testid={`equity-${asset.accountId}`} className="tabular-nums">
          {formatSignedCurrency(asset.value - debt)}
        </span>
      </p>
    </div>
  );
}

function Column({ title, side, rows, allRows, testId, onChanged }: {
  title: string; side: 'asset' | 'liability'; rows: RegisterRow[]; allRows: RegisterRow[];
  testId: string; onChanged: () => void;
}) {
  const total = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
  return (
    <div className="origin-card p-[var(--space-4)]">
      <div className="flex items-center justify-between mb-[var(--space-2)]">
        <h3 className="text-small text-[var(--color-text-base-subdued)]">{title}</h3>
        <AddItemSheet
          side={side}
          existingAssets={allRows.filter((r) => r.side === 'asset')}
          onCreated={onChanged}
        />
      </div>
      {rows.length === 0
        ? <p className="text-xsmall text-[var(--color-text-base-subdued)]">Nothing here yet.</p>
        : rows.map((r) => (
            <div key={r.accountId}>
              <Row row={r} onChanged={onChanged} />
              <SecuredUnder asset={r} allRows={allRows} />
            </div>
          ))}
      <div className="flex justify-between border-t border-[var(--color-border-base-subdued)] mt-[var(--space-2)] pt-[var(--space-2)]">
        <span className="text-small text-[var(--color-text-base-subdued)]">Total</span>
        <span data-testid={testId} className="text-small text-[var(--color-text-base-default)] tabular-nums">
          {formatCurrency(total)}
        </span>
      </div>
    </div>
  );
}

export default function BalanceSheet({ rows, onChanged }: { rows: RegisterRow[]; onChanged: () => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-4)]">
      <Column title="Assets" side="asset" testId="assets-total" onChanged={onChanged} allRows={rows}
        rows={rows.filter((r) => r.side === 'asset')} />
      <Column title="Liabilities" side="liability" testId="liabilities-total" onChanged={onChanged} allRows={rows}
        rows={rows.filter((r) => r.side === 'liability')} />
    </div>
  );
}
