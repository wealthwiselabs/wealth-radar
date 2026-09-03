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

function Row({ row, onChanged, providerConfigured }: {
  row: RegisterRow; onChanged: () => void; providerConfigured: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dropHistory, setDropHistory] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [addressDraft, setAddressDraft] = useState('');
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

  async function refreshEstimate() {
    setSaving(true);
    try {
      const res = await fetch('/api/net-worth/estimate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: row.accountId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 404 (no provider) and 409 (already refreshed today) are ordinary
        // outcomes, not faults — show what the server said and move on.
        setError(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
        return;
      }
      notifyDataChanged();
      onChanged();
    } catch {
      setError('Could not reach the valuation service.');
    } finally {
      setSaving(false);
    }
  }

  async function enableEstimates() {
    const address = addressDraft.trim();
    if (!address) {
      setError('Enter the property address.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/net-worth/accounts/${row.accountId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ valuationProvider: 'rentcast', valuationRef: address }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
        return;
      }
      setEnabling(false);
      setAddressDraft('');
      notifyDataChanged();
      onChanged();
    } catch {
      setError('Could not save the address.');
    } finally {
      setSaving(false);
    }
  }

  /**
   * One verb in the UI, with the destructive option as an explicit opt-in.
   *
   * Two buttons ("Close" for items with history, "Delete" for those without)
   * made the row's control change meaning depending on data the user cannot
   * see, and neither label explained what happened to past months. Now every
   * row offers Close, and the dialog carries the choice: keep the history
   * (the default, which keeps the trend chart correct for the months you owned
   * the thing) or remove it too, stated plainly and off by default.
   */
  async function remove(alsoRemoveHistory: boolean) {
    setConfirming(false);
    const month = new Date().toISOString().slice(0, 7);
    const res = alsoRemoveHistory
      ? await fetch(`/api/net-worth/accounts/${row.accountId}?withHistory=true`, { method: 'DELETE' })
      : await fetch(`/api/net-worth/accounts/${row.accountId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ closedAtMonth: month }),
        });
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
          {/* Gated on providerConfigured: with no provider set up, the page must
              never mention estimates, even for a row an estimate valued in the past. */}
          {providerConfigured && row.source === 'estimate' ? ' · estimate' : ''}
        </p>
        {error && <p className="text-xsmall text-[var(--color-text-critical)]">{error}</p>}
      </div>
      <div className="flex items-center gap-[var(--space-2)]">
        {/* An unvalued item is an em dash, never $0. The difference is the point.
            Signed, not formatCurrency: depository balances are stored signed
            (sync.ts), so an overdrawn checking account is a real negative that
            must show as such, not get silently flipped positive. Liability rows
            are magnitudes by construction, so this is a no-op for them. */}
        <span className="text-small text-[var(--color-text-base-default)] tabular-nums">
          {row.value === null ? '—' : formatSignedCurrency(row.value)}
        </span>
        {providerConfigured && row.source === 'estimate' && row.valueLow !== null && row.valueHigh !== null && (
          /* An AVM is a range, not a measurement. Showing only the midpoint beside a
             typed figure would present a model output as fact. */
          <span className="text-xsmall text-[var(--color-text-base-subdued)]"
            title={`Estimated range ${formatCurrency(row.valueLow)} – ${formatCurrency(row.valueHigh)}`}>
            est.
          </span>
        )}
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
        {/* All estimate UI — enable, refresh, the "est." badge above, and the
            "· estimate" text — is gated on providerConfigured. With no provider
            configured server-side, this page must never mention estimates. */}
        {providerConfigured && row.group === 'property' && (
          row.valuationRef ? (
            <button
              type="button"
              className="origin-btn origin-btn-ghost"
              aria-label={`Refresh estimate for ${row.name}`}
              disabled={saving}
              onClick={() => { void refreshEstimate(); }}
            >
              Refresh estimate
            </button>
          ) : enabling ? (
            <div className="flex flex-col items-end gap-[var(--space-1)]">
              <p className="text-xsmall text-[var(--color-text-base-subdued)] max-w-[220px] text-right">
                The address you enter is sent to RentCast, a third party, to estimate this
                property&apos;s value.
              </p>
              <input
                aria-label={`Address for ${row.name}`}
                className="origin-input w-48"
                placeholder="Property address"
                value={addressDraft}
                disabled={saving}
                onChange={(e) => { setAddressDraft(e.target.value); setError(null); }}
              />
              <div className="flex gap-[var(--space-2)]">
                <button
                  type="button"
                  className="origin-btn origin-btn-secondary"
                  disabled={saving}
                  onClick={() => { void enableEstimates(); }}
                >
                  Enable
                </button>
                <button
                  type="button"
                  className="origin-btn origin-btn-ghost"
                  disabled={saving}
                  onClick={() => { setEnabling(false); setAddressDraft(''); setError(null); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="origin-btn origin-btn-ghost"
              aria-label={`Enable estimates for ${row.name}`}
              onClick={() => setEnabling(true)}
            >
              Enable estimates
            </button>
          )
        )}
        <button
          type="button"
          className="origin-btn origin-btn-secondary"
          aria-label={`Close ${row.name}`}
          title="Counts through the end of this month, then stops. You choose whether to keep its past values."
          onClick={() => { setDropHistory(false); setError(null); setConfirming(true); }}
        >
          Close
        </button>

        {confirming && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-[var(--space-6)]"
            style={{ background: 'rgba(0,0,0,0.45)' }}
            onClick={(e) => { if (e.target === e.currentTarget) setConfirming(false); }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Close ${row.name}`}
              className="origin-card p-[var(--space-4)] space-y-[var(--space-3)] w-full max-w-md mt-[var(--space-8)]"
            >
              <p className="text-small font-medium text-[var(--color-text-base-default)]">
                Close {row.name}?
              </p>
              <p className="text-xsmall text-[var(--color-text-base-subdued)]">
                It counts through the end of this month, then stops. Its past values are kept by
                default, so the months you owned it stay correct on the trend chart.
              </p>

              <label className="flex items-start gap-[var(--space-2)] text-xsmall text-[var(--color-text-base-default)]">
                <input
                  type="checkbox"
                  aria-label="Also remove its past values"
                  checked={dropHistory}
                  onChange={(e) => setDropHistory(e.target.checked)}
                />
                <span>
                  Also remove its past values
                  {/* Stated before the click, not after. This is the one action
                      here that changes months already on the chart. */}
                  <span className="block text-[var(--color-text-warning)]">
                    Deletes the item and every value recorded for it. Past months will no longer
                    include it, and this cannot be undone.
                  </span>
                </span>
              </label>

              {error && <p className="text-xsmall text-[var(--color-text-critical)]">{error}</p>}

              <div className="flex gap-[var(--space-2)]">
                <button
                  type="button"
                  className="origin-btn origin-btn-primary"
                  onClick={() => { void remove(dropHistory); }}
                >
                  {dropHistory ? 'Close and remove values' : 'Close item'}
                </button>
                <button
                  type="button"
                  className="origin-btn origin-btn-secondary"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
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

function Column({ title, side, rows, allRows, testId, onChanged, providerConfigured }: {
  title: string; side: 'asset' | 'liability'; rows: RegisterRow[]; allRows: RegisterRow[];
  testId: string; onChanged: () => void; providerConfigured: boolean;
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
              <Row row={r} onChanged={onChanged} providerConfigured={providerConfigured} />
              <SecuredUnder asset={r} allRows={allRows} />
            </div>
          ))}
      <div className="flex justify-between border-t border-[var(--color-border-base-subdued)] mt-[var(--space-2)] pt-[var(--space-2)]">
        <span className="text-small text-[var(--color-text-base-subdued)]">Total</span>
        {/* Signed for the same reason as the row above: the liability column can
            never go negative (its rows are magnitudes by construction), so this
            is unobservable there, but the assets column legitimately can — an
            overdrawn depository account large enough to exceed the rest of the
            column would otherwise report a positive total for a negative sum. */}
        <span data-testid={testId} className="text-small text-[var(--color-text-base-default)] tabular-nums">
          {formatSignedCurrency(total)}
        </span>
      </div>
    </div>
  );
}

export default function BalanceSheet({ rows, onChanged, providerConfigured = false }: {
  rows: RegisterRow[]; onChanged: () => void; providerConfigured?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-4)]">
      <Column title="Assets" side="asset" testId="assets-total" onChanged={onChanged} allRows={rows}
        providerConfigured={providerConfigured} rows={rows.filter((r) => r.side === 'asset')} />
      <Column title="Liabilities" side="liability" testId="liabilities-total" onChanged={onChanged} allRows={rows}
        providerConfigured={providerConfigured} rows={rows.filter((r) => r.side === 'liability')} />
    </div>
  );
}
