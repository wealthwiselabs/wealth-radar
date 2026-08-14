'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { notifyDataChanged } from '@/lib/dataEvents';
import RulePreviewModal from '@/app/components/RulePreviewModal';
import type { Category, CategoryRule } from '@/types';

/** A rule beyond that many distinct categories is almost always a payment
 *  prefix (AplPay, Zelle) rather than one merchant — matches the API's
 *  `warnManyCategories` threshold in ruleBackfill.ts. */
const MANY_CATEGORIES = 5;

type RuleRow = CategoryRule & { totalMatches: number; distinctCategories: number };

/** What's awaiting the in-page confirmation UI, and for which row. Native
 *  `window.confirm` is suppressible (Chrome/Safari's "prevent additional
 *  dialogs", and automated browsers outright), so it silently returns
 *  `false` after a page has shown a few — exactly the failure mode a
 *  19-rule triage screen hits fast. This state drives an inline
 *  confirm/cancel swap in the row's action cell instead, which the browser
 *  cannot suppress. Only one row can hold this at a time, so starting a
 *  confirmation elsewhere naturally cancels whichever row had it before. */
type PendingConfirm = { id: string; kind: 'enable' | 'reapply' | 'delete' };

export default function RulesPage() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  // Returns whether the refresh actually landed, so callers that already
  // know their mutation succeeded can tell "mutation failed" apart from
  // "mutation succeeded but the refresh didn't" instead of blaming the
  // mutation for a failure that happened after it.
  const load = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/rules');
      if (res.ok) {
        const data = (await res.json()) as { rules: RuleRow[] };
        setRules(data.rules);
        return true;
      }
      setError('Could not load rules.');
      return false;
    } catch {
      setError('Could not load rules.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch('/api/taxonomy')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setCategories(data.categories ?? []); })
      .catch(() => {});
  }, []);

  // Same lookup TransactionsTable builds, so this screen reads "Housing >
  // Rent" instead of the raw slugs ("housing"/"rent") the API returns.
  const categoryMap = useMemo(() => {
    const map: Record<string, { name: string; subcategoryMap: Record<string, string> }> = {};
    for (const cat of categories) {
      const subcategoryMap: Record<string, string> = {};
      for (const sub of cat.subcategories) subcategoryMap[sub.id] = sub.name;
      map[cat.id] = { name: cat.name, subcategoryMap };
    }
    return map;
  }, [categories]);

  const labelFor = useCallback((categoryId: string, subcategoryId: string) => {
    const cat = categoryMap[categoryId];
    if (!cat) return `${categoryId} > ${subcategoryId}`;
    return `${cat.name} > ${cat.subcategoryMap[subcategoryId] ?? subcategoryId}`;
  }, [categoryMap]);

  // The three handlers below are split into a synchronous "does this need
  // confirmation?" gate and an async "do the actual work" function. The gate
  // either runs the work immediately (nothing to confirm) or parks it behind
  // the inline confirm UI via `pendingConfirm`; `confirmPending` below is what
  // actually invokes the async part once the user clicks Confirm.

  const doToggle = async (rule: RuleRow) => {
    setBusyId(rule.id);
    setMessage(null);
    setError(null);
    try {
      try {
        const res = await fetch(`/api/rules/${rule.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !rule.enabled }),
        });
        if (!res.ok) {
          setError(`Could not ${rule.enabled ? 'disable' : 'enable'} "${rule.pattern}".`);
          return;
        }
      } catch {
        setError(`Could not ${rule.enabled ? 'disable' : 'enable'} "${rule.pattern}".`);
        return;
      }
      // The mutation above already succeeded. If the refresh below fails,
      // that's a distinct, later failure — say so, don't blame the toggle.
      const refreshed = await load();
      if (!refreshed) {
        setError(
          `${rule.enabled ? 'Disabled' : 'Enabled'} "${rule.pattern}", but the list could not refresh. Reload the page to see the current state.`,
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const toggle = (rule: RuleRow) => {
    // Disabling is always safe. Enabling a narrow rule is too. But enabling a
    // rule whose matches span many categories (the same ⚠ threshold above)
    // is about to start silently governing future imports across all of
    // them — worth a confirm, same bar as the warning icon uses.
    if (!rule.enabled && rule.distinctCategories > MANY_CATEGORIES) {
      setPendingConfirm({ id: rule.id, kind: 'enable' });
      return;
    }
    void doToggle(rule);
  };

  const doReapply = async (rule: RuleRow) => {
    setBusyId(rule.id);
    setMessage(null);
    setError(null);
    try {
      let data: { changed: number; skippedManual: number };
      try {
        const res = await fetch(`/api/rules/${rule.id}/apply`, { method: 'POST' });
        if (!res.ok) {
          setError(`Could not apply "${rule.pattern}".`);
          return;
        }
        data = (await res.json()) as { changed: number; skippedManual: number };
      } catch {
        setError(`Could not apply "${rule.pattern}".`);
        return;
      }
      notifyDataChanged();
      // The apply above already succeeded (and already changed data), so a
      // refresh failure from here on must not read as "the apply failed".
      const refreshed = await load();
      if (refreshed) {
        setMessage(
          `"${rule.pattern}": ${data.changed} transactions updated, ${data.skippedManual} skipped as manual.`,
        );
      } else {
        setError(
          `"${rule.pattern}" was applied (${data.changed} updated, ${data.skippedManual} skipped as manual), but the list could not refresh. Reload the page to see the current state.`,
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const reapply = (rule: RuleRow) => {
    setPendingConfirm({ id: rule.id, kind: 'reapply' });
  };

  const doRemove = async (rule: RuleRow) => {
    setBusyId(rule.id);
    setMessage(null);
    setError(null);
    try {
      try {
        const res = await fetch(`/api/rules/${rule.id}`, { method: 'DELETE' });
        if (!res.ok) {
          setError(`Could not delete "${rule.pattern}".`);
          return;
        }
      } catch {
        setError(`Could not delete "${rule.pattern}".`);
        return;
      }
      // The delete above already succeeded. A refresh failure now is a
      // separate, later problem — say so, don't imply the delete failed.
      const refreshed = await load();
      if (!refreshed) {
        setError(
          `Deleted "${rule.pattern}", but the list could not refresh. Reload the page to see the current state.`,
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const remove = (rule: RuleRow) => {
    setPendingConfirm({ id: rule.id, kind: 'delete' });
  };

  const confirmPending = (rule: RuleRow) => {
    const kind = pendingConfirm?.kind;
    setPendingConfirm(null);
    if (kind === 'enable') void doToggle(rule);
    else if (kind === 'reapply') void doReapply(rule);
    else if (kind === 'delete') void doRemove(rule);
  };

  const cancelPending = () => setPendingConfirm(null);

  const confirmMessageFor = (rule: RuleRow, kind: PendingConfirm['kind']) => {
    if (kind === 'delete') {
      return `Delete the rule "${rule.pattern}"? This only removes the rule — transactions it already changed keep their category.`;
    }
    if (kind === 'reapply') {
      return `Re-apply "${rule.pattern}" → ${labelFor(rule.categoryId, rule.subcategoryId)}? `
        + `This will rewrite ${rule.totalMatches} matching transaction${rule.totalMatches === 1 ? '' : 's'}.`;
    }
    return `Enable "${rule.pattern}"? Its matches span ${rule.distinctCategories} different categories, and once enabled it will govern how future imports are categorized.`;
  };

  return (
    <main className="min-h-screen p-[var(--space-6)] max-w-6xl mx-auto">
      <div className="mb-[var(--space-6)]">
        <h1 className="heading-large text-[var(--color-text-base-default)]">Category rules</h1>
        <p className="text-small text-[var(--color-text-base-subdued)]">
          A rule assigns a category to every transaction whose description contains its pattern.
          Rules never change a category you set by hand.
        </p>
      </div>

      {message && (
        <div className="mb-[var(--space-4)] p-[var(--space-2)] text-small rounded-[var(--radius-2)] bg-[var(--color-background-base-subdued)] text-[var(--color-text-base-default)]">
          {message}
        </div>
      )}
      {error && (
        <div className="mb-[var(--space-4)] p-[var(--space-2)] text-small rounded-[var(--radius-2)] bg-[var(--color-background-critical-subdued)] text-[var(--color-text-critical)]">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">Loading rules...</p>
      ) : rules.length === 0 ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">
          No rules yet. Correct a transaction&apos;s category and you&apos;ll be offered one.
        </p>
      ) : (
        <div className="origin-card overflow-x-auto">
          <table className="w-full text-small">
            <thead className="bg-[var(--color-background-base-subdued)]">
              <tr>
                <th className="w-8 py-[var(--space-2)] px-[var(--space-3)]" />
                <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                  Pattern
                </th>
                <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                  Category
                </th>
                <th className="text-right py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)]">
                  Matches
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
              {rules.map((r) => {
                const suspicious = r.distinctCategories > MANY_CATEGORIES;
                const busy = busyId === r.id;
                return (
                  <tr key={r.id} className="border-t border-[var(--color-border-base-subdued)]">
                    <td className="py-[var(--space-2)] px-[var(--space-3)]">
                      {suspicious && (
                        <span
                          className="text-[var(--color-text-warning)]"
                          title={`Matches span ${r.distinctCategories} categories — this usually means the pattern is a payment prefix, not one merchant.`}
                        >
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className="py-[var(--space-2)] px-[var(--space-3)] font-mono text-[var(--color-text-base-default)]">
                      {r.pattern}
                    </td>
                    <td className="py-[var(--space-2)] px-[var(--space-3)] text-[var(--color-text-base-subdued)]">
                      {labelFor(r.categoryId, r.subcategoryId)}
                    </td>
                    <td className="py-[var(--space-2)] px-[var(--space-3)] text-right text-[var(--color-text-base-subdued)] whitespace-nowrap">
                      {r.totalMatches} <span className="text-xsmall">({r.distinctCategories} categories)</span>
                    </td>
                    <td className="py-[var(--space-2)] px-[var(--space-3)]">
                      <span
                        className="origin-badge"
                        style={{
                          background: r.enabled
                            ? 'var(--color-background-success-subdued)'
                            : 'var(--color-background-base-subdued)',
                          color: r.enabled
                            ? 'var(--color-text-success)'
                            : 'var(--color-text-base-subdued)',
                        }}
                      >
                        {r.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="py-[var(--space-2)] px-[var(--space-3)] text-right">
                      {pendingConfirm?.id === r.id ? (
                        // In-page confirmation, not window.confirm: browsers let
                        // users (and automated ones do it unconditionally)
                        // suppress repeated native dialogs, after which
                        // confirm() silently returns false forever. This row
                        // swap can't be suppressed the same way.
                        <div className="flex flex-col items-end gap-[var(--space-2)] whitespace-normal">
                          <span className="text-xsmall text-[var(--color-text-base-subdued)] text-right max-w-[28rem]">
                            {confirmMessageFor(r, pendingConfirm.kind)}
                          </span>
                          <div className="flex gap-[var(--space-2)] justify-end">
                            <button
                              className="origin-btn origin-btn-ghost"
                              onClick={cancelPending}
                            >
                              Cancel
                            </button>
                            <button
                              className="origin-btn origin-btn-primary"
                              onClick={() => confirmPending(r)}
                            >
                              Confirm
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-[var(--space-2)] justify-end flex-wrap whitespace-nowrap">
                          <button
                            className="origin-btn origin-btn-ghost"
                            onClick={() => toggle(r)}
                            disabled={busy}
                          >
                            {r.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            className="origin-btn origin-btn-ghost"
                            onClick={() => setEditing(r)}
                            disabled={busy}
                          >
                            Edit
                          </button>
                          <button
                            className="origin-btn origin-btn-ghost"
                            onClick={() => reapply(r)}
                            disabled={busy || !r.enabled}
                            title={r.enabled ? undefined : 'Enable this rule before applying it to past transactions.'}
                          >
                            Re-apply
                          </button>
                          <button
                            className="origin-btn origin-btn-ghost"
                            style={{ color: 'var(--color-text-critical)' }}
                            onClick={() => remove(r)}
                            disabled={busy}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RulePreviewModal
          initialPattern={editing.pattern}
          ruleId={editing.id}
          categoryId={editing.categoryId}
          subcategoryId={editing.subcategoryId}
          categories={categories}
          onClose={() => { setEditing(null); load(); }}
        />
      )}
    </main>
  );
}
