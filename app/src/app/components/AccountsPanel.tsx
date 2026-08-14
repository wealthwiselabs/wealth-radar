'use client';

import { useCallback, useEffect, useState } from 'react';
import { accountDisplayName } from '@/lib/accountDisplay';
import { ACCOUNT_OWNER_OPTIONS } from '@/lib/owners';

interface Account {
  id: string;
  institution: string;
  name: string;
  owner: string;
  mask: string | null;
  nameSource: string;
  needsName: boolean;
  accountClass: string;
  status: string;
  closedAtMonth: string | null;
  txnCount: number;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

interface AccountsPanelProps {
  /** Called after a rename/close/merge so the host page can refresh transactions. */
  onChanged?: () => void;
}

function displayName(a: Account, all: Account[]): string {
  return accountDisplayName(a, all);
}

export default function AccountsPanel({ onChanged }: AccountsPanelProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editOwner, setEditOwner] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/accounts');
      if (res.ok) {
        const data = await res.json();
        // Investment-class accounts live in the /accounts "Investment accounts"
        // group (AccountTable, sourced from /api/investments/accounts). Excluding
        // them here keeps this "Bank accounts" panel from listing them twice.
        setAccounts((data.accounts ?? []).filter((a: Account) => a.accountClass !== 'investment'));
      } else {
        setError('Failed to load accounts.');
      }
    } catch {
      setError('Failed to load accounts.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Editing the three parts separately (owner / institution / label) rather than
  // one concatenated display string: the display is derived, so letting the user
  // retype it means guessing which prefix they meant to keep.
  const startEdit = (a: Account) => {
    setEditingId(a.id);
    setEditName(a.name);
    setEditOwner(a.owner);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditOwner('');
  };

  const saveEdit = async (a: Account) => {
    const newName = editName.trim();
    if (!newName) {
      cancelEdit();
      return;
    }
    // Only send `name` when it actually changed — the server marks any supplied
    // name as user-assigned, and an owner-only edit must not silently promote a
    // derived name and exempt it from future canonicalization.
    const patch: Record<string, string> = {};
    if (newName !== a.name) patch.name = newName;
    if (editOwner !== a.owner) patch.owner = editOwner;
    if (Object.keys(patch).length === 0) {
      cancelEdit();
      return;
    }
    try {
      const res = await fetch(`/api/accounts/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        cancelEdit();
        await fetchAccounts();
        onChanged?.();
      } else {
        setError('Save failed.');
      }
    } catch {
      setError('Save failed.');
    }
  };

  const patchAccount = async (a: Account, patch: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/accounts/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        await fetchAccounts();
        onChanged?.();
      } else {
        setError('Update failed.');
      }
    } catch {
      setError('Update failed.');
    }
  };

  const closeAccount = async (a: Account) => {
    const raw = window.prompt(
      `Close "${displayName(a, accounts)}"? Its transactions are kept, but coverage stops expecting new activity from this month on.\n\nClosed-at month (YYYY-MM, blank = this month):`,
      currentMonth(),
    );
    if (raw === null) return; // cancelled
    const trimmed = raw.trim();
    // Only send a valid YYYY-MM; invalid/blank input is dropped so the server
    // defaults to the current month rather than writing a string that would
    // break the coverage engine's `month > closedAtMonth` comparison.
    const closedAtMonth = /^\d{4}-\d{2}$/.test(trimmed) ? trimmed : undefined;
    await patchAccount(a, { status: 'closed', ...(closedAtMonth ? { closedAtMonth } : {}) });
  };

  const reopenAccount = async (a: Account) => {
    await patchAccount(a, { status: 'active' });
  };

  const removeAccount = async (a: Account) => {
    if (!window.confirm(`Remove "${displayName(a, accounts)}" and all its data? This cannot be undone.\n\nIf it is synced from a connected bank, it may reappear on the next sync — Disconnect the connection to remove it permanently.`)) return;
    try {
      const res = await fetch(`/api/accounts/${a.id}/remove`, { method: 'POST' });
      if (res.ok) {
        await fetchAccounts();
        onChanged?.();
      } else {
        setError('Remove failed.');
      }
    } catch {
      setError('Remove failed.');
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (mergeTargetId === id) setMergeTargetId(null);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectedAccounts = accounts.filter((a) => selected.has(a.id));

  const doMerge = async () => {
    if (!mergeTargetId || selectedAccounts.length < 2) return;
    const target = selectedAccounts.find((a) => a.id === mergeTargetId);
    const sources = selectedAccounts.filter((a) => a.id !== mergeTargetId);
    if (!target || sources.length === 0) return;
    if (
      !window.confirm(
        `Merge ${sources.length} account(s) into "${displayName(target, accounts)}"? ` +
          `Their transactions move to it and exact duplicates are removed. This can't be undone.`,
      )
    ) {
      return;
    }
    const sourceIds = sources.map((a) => a.id);
    setIsMerging(true);
    setError(null);
    try {
      const res = await fetch('/api/accounts/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: mergeTargetId, sourceIds }),
      });
      if (res.ok) {
        setSelected(new Set());
        setMergeTargetId(null);
        await fetchAccounts();
        onChanged?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Merge failed.');
      }
    } catch {
      setError('Merge failed.');
    } finally {
      setIsMerging(false);
    }
  };

  const classBadge = (accountClass: string) => {
    const label = accountClass.charAt(0).toUpperCase() + accountClass.slice(1);
    return (
      <span
        className="origin-badge"
        style={{
          background: 'var(--color-background-base-subdued)',
          color: 'var(--color-text-base-subdued)',
        }}
      >
        {label}
      </span>
    );
  };

  const statusBadge = (status: string) => {
    const isActive = status === 'active';
    return (
      <span
        className="origin-badge"
        style={{
          background: isActive ? 'var(--color-background-success-subdued)' : 'var(--color-background-critical-subdued)',
          color: isActive ? 'var(--color-text-success)' : 'var(--color-text-critical)',
        }}
      >
        {isActive ? 'Active' : 'Closed'}
      </span>
    );
  };

  return (
    <div>
      {error && (
        <div className="mb-[var(--space-3)] p-[var(--space-2)] text-small rounded-[var(--radius-2)] bg-[var(--color-background-critical-subdued)] text-[var(--color-text-critical)]">
          {error}
        </div>
      )}

      {isLoading ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">Loading accounts...</p>
      ) : accounts.length === 0 ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">No accounts yet.</p>
      ) : (
        <div className="origin-card overflow-x-auto">
          {/* overflow-x-auto, not hidden: the table is wider than the settings
              modal, and clipping it silently put the row actions out of reach. */}
          <table className="w-full text-small">
            <thead className="bg-[var(--color-background-base-subdued)]">
              <tr>
                <th className="w-8 py-[var(--space-2)] px-[var(--space-3)]" />
                <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                  Account
                </th>
                <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                  Class
                </th>
                <th className="text-right py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                  Txns
                </th>
                <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                  Status
                </th>
                <th className="text-right py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-[var(--color-border-base-subdued)]">
                  <td className="py-[var(--space-2)] px-[var(--space-3)]">
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelected(a.id)}
                      aria-label={`Select ${displayName(a, accounts)} for merge`}
                    />
                  </td>
                  <td className="py-[var(--space-2)] px-[var(--space-3)]">
                    {editingId === a.id ? (
                      <div
                        className="flex flex-col gap-[var(--space-2)] min-w-[220px]"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(a);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                      >
                        <label className="flex items-center gap-[var(--space-2)] text-xsmall text-[var(--color-text-base-subdued)]">
                          Owner
                          <select
                            value={editOwner}
                            onChange={(e) => setEditOwner(e.target.value)}
                            className="origin-input flex-1"
                            aria-label="Owner"
                          >
                            {ACCOUNT_OWNER_OPTIONS.map((o) => (
                              <option key={o} value={o}>
                                {o === '' ? 'Unassigned' : o}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-[var(--space-2)] text-xsmall text-[var(--color-text-base-subdued)]">
                          Name
                          {/* Institution is fixed: it identifies the bank the data
                              came from, and editing it would orphan the account
                              from its statements and Plaid Item. */}
                          <span className="text-[var(--color-text-base-default)] whitespace-nowrap">
                            {a.institution}
                          </span>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="origin-input flex-1 min-w-0"
                            placeholder="e.g. Sapphire"
                            aria-label="Account name"
                            autoFocus
                          />
                        </label>
                        {a.mask && (
                          <span className="text-xsmall text-[var(--color-text-base-disabled)]">
                            Card ending {a.mask}
                          </span>
                        )}
                        <div className="flex gap-[var(--space-2)]">
                          <button onClick={() => saveEdit(a)} className="origin-btn origin-btn-primary">
                            Save
                          </button>
                          <button onClick={cancelEdit} className="origin-btn origin-btn-secondary">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(a)}
                        className="text-left text-[var(--color-text-base-default)] hover:underline"
                        title="Click to edit owner and name"
                      >
                        {displayName(a, accounts)}
                        {a.needsName && (
                          <span
                            className="origin-badge ml-[var(--space-2)]"
                            style={{
                              background: 'var(--color-background-warning-subdued)',
                              color: 'var(--color-text-warning)',
                            }}
                            title="Your bank does not report this card's product name — click to name it."
                          >
                            Needs a name
                          </span>
                        )}
                      </button>
                    )}
                  </td>
                  <td className="py-[var(--space-2)] px-[var(--space-3)]">{classBadge(a.accountClass)}</td>
                  <td className="py-[var(--space-2)] px-[var(--space-3)] text-right text-[var(--color-text-base-subdued)]">
                    {a.txnCount}
                  </td>
                  <td className="py-[var(--space-2)] px-[var(--space-3)]">
                    <div className="flex flex-col gap-[var(--space-1)]">
                      {statusBadge(a.status)}
                      {a.status === 'closed' && a.closedAtMonth && (
                        <span className="text-[var(--color-text-base-subdued)]">Closed at {a.closedAtMonth}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-[var(--space-2)] px-[var(--space-3)] text-right whitespace-nowrap">
                    {editingId !== a.id && (
                      <div className="flex gap-[var(--space-2)] justify-end">
                        {/* Rename lives on the account name itself — click it. */}
                        {a.status === 'active' ? (
                          <button onClick={() => closeAccount(a)} className="origin-btn origin-btn-ghost">
                            Close
                          </button>
                        ) : (
                          <button onClick={() => reopenAccount(a)} className="origin-btn origin-btn-ghost">
                            Reopen
                          </button>
                        )}
                        <button onClick={() => removeAccount(a)} className="origin-btn origin-btn-ghost">
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedAccounts.length >= 2 && (
        <div className="mt-[var(--space-4)] p-[var(--space-4)] rounded-[var(--radius-2)] bg-[var(--color-background-info-subdued)] border border-[var(--color-border-focus)]">
          <p className="text-small font-medium text-[var(--color-text-base-default)] mb-[var(--space-2)]">
            Merge {selectedAccounts.length} accounts — choose the target to keep:
          </p>
          <div className="flex flex-col gap-[var(--space-1)] mb-[var(--space-3)]">
            {selectedAccounts.map((a) => (
              <label key={a.id} className="flex items-center gap-[var(--space-2)] text-small text-[var(--color-text-base-default)]">
                <input
                  type="radio"
                  name="merge-target"
                  checked={mergeTargetId === a.id}
                  onChange={() => setMergeTargetId(a.id)}
                />
                {displayName(a, accounts)} ({a.txnCount} txns)
              </label>
            ))}
          </div>
          <div className="flex gap-[var(--space-2)]">
            <button
              onClick={doMerge}
              disabled={!mergeTargetId || isMerging}
              className="origin-btn origin-btn-primary"
            >
              {isMerging ? 'Merging...' : 'Merge'}
            </button>
            <button
              onClick={() => {
                setSelected(new Set());
                setMergeTargetId(null);
              }}
              className="origin-btn origin-btn-secondary"
              disabled={isMerging}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
