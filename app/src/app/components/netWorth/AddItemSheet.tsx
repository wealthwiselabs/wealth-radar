'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATALOG, type CatalogItem } from '@/lib/netWorth/catalog';
import { notifyDataChanged } from '@/lib/dataEvents';
import type { RegisterRow } from '@/app/net-worth/page';

interface Props {
  side: 'asset' | 'liability';
  existingAssets: RegisterRow[];
  onCreated: () => void;
}

/** Pure: the catalog entries offered for a side, filtered by the search text. */
export function catalogOptions(side: 'asset' | 'liability', query: string): CatalogItem[] {
  return CATALOG.filter((c) => c.side === side && c.label.toLowerCase().includes(query.toLowerCase()));
}

export default function AddItemSheet({ side, existingAssets, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<CatalogItem | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [securedBy, setSecuredBy] = useState('');
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => catalogOptions(side, query), [side, query]);

  const securityOptions = picked?.securedByGroup
    ? existingAssets.filter((a) => a.group === picked.securedByGroup)
    : [];

  const reset = useCallback(() => {
    setOpen(false); setQuery(''); setPicked(null);
    setName(''); setValue(''); setSecuredBy(''); setError(null);
  }, []);

  // Escape closes. Without it the only way out of the first step was to pick an
  // item you did not want just to reach a Cancel button — the search step had
  // no dismiss control at all, so opening the sheet by accident trapped you.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') reset(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, reset]);

  async function save() {
    if (!picked) return;
    if (name.trim() === '') { setError('Give it a name.'); return; }
    const parsed = value.trim() === '' ? null : Number(value.replace(/[$,\s]/g, ''));
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setError('Enter a positive amount, or leave it blank to value it later.');
      return;
    }
    try {
      const res = await fetch('/api/net-worth/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          catalogKey: picked.key, name: name.trim(), value: parsed,
          securedByAccountId: securedBy || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
      }
      notifyDataChanged();
      onCreated();
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the item.');
    }
  }

  if (!open) {
    return (
      <button type="button" className="origin-btn origin-btn-secondary" onClick={() => setOpen(true)}>
        + Add item
      </button>
    );
  }

  const title = picked ? `Add ${picked.label.toLowerCase()}` : `Add ${side === 'asset' ? 'an asset' : 'a liability'}`;

  return (
    // Modal rather than an inline panel. Inline, the search step rendered no
    // dismiss control at all, so opening it by accident left no way back except
    // picking an item you did not want. A backdrop, an explicit close, and
    // Escape give three ways out from either step.
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-[var(--space-6)]"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      // Only a click on the backdrop ITSELF closes — a click that started
      // inside the dialog and drifted out (selecting text in an input) must not
      // discard what the user typed.
      onClick={(e) => { if (e.target === e.currentTarget) reset(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="origin-card p-[var(--space-4)] space-y-[var(--space-3)] w-full max-w-md mt-[var(--space-8)]"
      >
        <div className="flex items-center justify-between gap-[var(--space-3)]">
          <p className="text-small font-medium text-[var(--color-text-base-default)]">{title}</p>
          <button
            type="button"
            // "Close dialog", not "Close": every register row also has a Close
            // button, and a bare "Close" would be ambiguous to both a screen
            // reader user scanning the page and to a test selector.
            aria-label="Close dialog"
            className="origin-btn origin-btn-ghost"
            onClick={reset}
          >
            Cancel
          </button>
        </div>

      {!picked ? (
        <>
          <label htmlFor="nw-search" className="text-small text-[var(--color-text-base-subdued)]">Search items</label>
          <input id="nw-search" aria-label="Search items" className="origin-input w-full"
            value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <div className="flex flex-wrap gap-[var(--space-2)]">
            {matches.map((c) => (
              <button key={c.key} type="button" className="origin-btn origin-btn-secondary"
                onClick={() => { setPicked(c); setName(c.label); }}>
                {c.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-small text-[var(--color-text-base-default)]">{picked.label}</p>

          <label htmlFor="nw-name" className="text-small text-[var(--color-text-base-subdued)]">Name</label>
          <input id="nw-name" aria-label="Name" className="origin-input w-full"
            value={name} onChange={(e) => setName(e.target.value)} />

          <label htmlFor="nw-value" className="text-small text-[var(--color-text-base-subdued)]">Current value</label>
          <input id="nw-value" aria-label="Current value" className="origin-input w-full" inputMode="decimal"
            value={value} onChange={(e) => setValue(e.target.value)} />
          {picked.hint && (
            <p className="text-xsmall text-[var(--color-text-base-subdued)]">{picked.hint}</p>
          )}
          {value.trim() === '' && (
            /* Said before saving, not after. An unvalued item is allowed but it
               lands in the exclusion banner, and that should not be a surprise. */
            <p className="text-xsmall text-[var(--color-text-warning)]">
              This won&apos;t count toward your net worth until you value it.
            </p>
          )}

          {picked.securedByGroup && (
            <>
              <label htmlFor="nw-secured" className="text-small text-[var(--color-text-base-subdued)]">Secured by</label>
              <select id="nw-secured" aria-label="Secured by" className="origin-select w-full"
                value={securedBy} onChange={(e) => setSecuredBy(e.target.value)}>
                <option value="">Nothing</option>
                {securityOptions.map((a) => (
                  <option key={a.accountId} value={a.accountId}>{a.name}</option>
                ))}
              </select>
            </>
          )}

          {error && <p className="text-xsmall text-[var(--color-text-critical)]">{error}</p>}

          <div className="flex gap-[var(--space-2)]">
            <button type="button" className="origin-btn origin-btn-primary" onClick={() => { void save(); }}>Save</button>
            <button type="button" className="origin-btn origin-btn-secondary" onClick={() => setPicked(null)}>Back</button>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
