'use client';

import { useState } from 'react';
import { formatCurrency } from '@/lib/chartConfig';

export interface AccountRow {
  id: string;
  institution: string;
  name: string;
  owner: string;
  purpose: string;
  latestValue: number | null;
  latestAsOf: string | null;
  stale: boolean;
}

export default function AccountTable({
  accounts,
  onPurposeChange,
  onRename,
  onRemove,
}: {
  accounts: AccountRow[];
  onPurposeChange?: (id: string, purpose: string) => void;
  onRename?: (id: string, name: string) => void;
  onRemove?: (id: string) => void;
}) {
  // Which row's name is being edited, and the working draft. Only the `name`
  // part is editable; `institution` is shown but fixed (matching the bank panel).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (accounts.length === 0) {
    return <p className="text-small text-[var(--color-text-base-subdued)]">No investment accounts yet.</p>;
  }

  const startEdit = (a: AccountRow) => { setEditingId(a.id); setDraft(a.name); };
  const cancel = () => { setEditingId(null); setDraft(''); };
  const save = (id: string) => {
    const next = draft.trim();
    if (next && onRename) onRename(id, next);
    setEditingId(null);
    setDraft('');
  };

  return (
    <table className="w-full text-small">
      <thead>
        <tr className="text-left text-xsmall uppercase text-[var(--color-text-base-subdued)]">
          <th className="py-[var(--space-2)] font-medium">Account</th>
          <th className="py-[var(--space-2)] font-medium">Owner</th>
          <th className="py-[var(--space-2)] font-medium">Purpose</th>
          <th className="py-[var(--space-2)] font-medium text-right">Value</th>
          <th className="py-[var(--space-2)] font-medium text-right">Captured</th>
          {onRemove && <th className="py-[var(--space-2)] font-medium text-right">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {accounts.map((a) => (
          <tr key={a.id} className="border-t border-[var(--color-border-base-subdued)]">
            <td className="py-[var(--space-2)] text-[var(--color-text-base-default)]">
              {editingId === a.id ? (
                <span className="inline-flex items-center gap-[var(--space-2)] flex-wrap">
                  <span className="text-[var(--color-text-base-subdued)]">{a.institution} ·</span>
                  <input
                    className="origin-input text-small py-[var(--space-1)]"
                    value={draft}
                    autoFocus
                    aria-label={`Name for ${a.institution} ${a.name}`}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') save(a.id);
                      if (e.key === 'Escape') cancel();
                    }}
                  />
                  <button
                    type="button"
                    className="origin-btn origin-btn-secondary text-xsmall py-[var(--space-1)]"
                    disabled={!draft.trim()}
                    onClick={() => save(a.id)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="origin-btn text-xsmall py-[var(--space-1)]"
                    onClick={cancel}
                  >
                    Cancel
                  </button>
                </span>
              ) : onRename ? (
                <button
                  type="button"
                  className="text-left text-[var(--color-text-base-default)] hover:underline"
                  title="Click to rename"
                  onClick={() => startEdit(a)}
                >
                  {a.institution} · {a.name}
                </button>
              ) : (
                <>{a.institution} · {a.name}</>
              )}
            </td>
            <td className="py-[var(--space-2)] text-[var(--color-text-base-subdued)]">{a.owner || '—'}</td>
            <td className="py-[var(--space-2)] text-[var(--color-text-base-subdued)]">
              {onPurposeChange ? (
                <select
                  className="origin-select text-small py-[var(--space-1)]"
                  value={a.purpose}
                  onChange={(e) => onPurposeChange(a.id, e.target.value)}
                  aria-label={`Purpose for ${a.institution} ${a.name}`}
                >
                  <option value="portfolio">portfolio</option>
                  <option value="reserve">reserve</option>
                  <option value="insurance">insurance</option>
                  <option value="education">education</option>
                </select>
              ) : (
                a.purpose
              )}
            </td>
            <td className="py-[var(--space-2)] text-right text-[var(--color-text-base-default)]">
              {a.latestValue === null ? '—' : formatCurrency(a.latestValue)}
            </td>
            <td className={`py-[var(--space-2)] text-right ${a.stale ? 'text-[var(--color-text-warning)]' : 'text-[var(--color-text-base-subdued)]'}`}>
              {a.latestAsOf ?? 'never'}
            </td>
            {onRemove && (
              <td className="py-[var(--space-2)] text-right">
                <button
                  type="button"
                  className="origin-btn origin-btn-secondary"
                  onClick={() => onRemove(a.id)}
                >
                  Remove
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
