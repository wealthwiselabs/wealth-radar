'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { notifyDataChanged } from '@/lib/dataEvents';
// Pure string transform (trim/collapse/lowercase) with no server-only deps,
// so importing it into this client component is safe.
import { normalizePattern } from '@/lib/categoryRules';
import type { Category } from '@/types';

interface ImpactSample {
  id: string; date: string; description: string; amount: number;
  categoryId: string; subcategoryId: string;
}

interface Preview {
  pattern: string;
  totalMatches: number;
  alreadyCorrect: number;
  willChange: number;
  skippedManual: number;
  distinctCategories: number;
  warnHighMatchRate: boolean;
  warnManyCategories: boolean;
  samples: ImpactSample[];
  tooShort: boolean;
}

interface RulePreviewModalProps {
  /** Seed the pattern from a raw description (correction flow). */
  description?: string;
  /** Seed from an existing pattern (rules-screen edit). Wins over description. */
  initialPattern?: string;
  /** When set, saving updates this rule instead of creating one. */
  ruleId?: string;
  /** Initial target. Editable in the modal, so these seed state rather than fix it. */
  categoryId: string;
  subcategoryId: string;
  /** Full taxonomy, for the target dropdowns. */
  categories: Category[];
  onClose: () => void;
}

export default function RulePreviewModal({
  description, initialPattern, ruleId, categoryId, subcategoryId, categories, onClose,
}: RulePreviewModalProps) {
  // The target the rule will assign. Seeded from the correction (or the rule
  // being edited) but adjustable here — the user is being asked to commit to a
  // rule, which is the natural moment to notice the pair is not quite right.
  const [catId, setCatId] = useState(categoryId);
  const [subId, setSubId] = useState(subcategoryId);
  // null means "not seeded yet" — the first fetch sends the raw description and
  // lets the server suggest a pattern. An edit already has one, so it skips that.
  const [pattern, setPattern] = useState<string | null>(initialPattern ?? null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmedWarning, setConfirmedWarning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against two runtime hazards inherent to a debounced fetch:
  // an unmounted component receiving a late response, and an older request
  // resolving after a newer one (out-of-order network responses).
  const isMountedRef = useRef(true);
  const requestIdRef = useRef(0);
  // Must set true on mount, not just rely on the useRef(true) initializer:
  // React Strict Mode (on by default in `next dev`) mounts, cleans up, and
  // re-mounts every effect once. Without the explicit re-arm here, that
  // cleanup permanently flips this to false before the component's "real"
  // life begins, and every load() response is then silently dropped forever
  // — the pattern field and Apply button never populate.
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // A preview is only valid for the (pattern, category, subcategory) triple it
  // was fetched for: alreadyCorrect/willChange are counted against the target,
  // so re-pointing the dropdowns invalidates it just as surely as editing the
  // pattern does. Keying on the pattern alone would leave the old target's
  // counts on screen after a category change.
  const selectionKey = (p: string, c: string, s: string) => `${normalizePattern(p)}|${c}|${s}`;
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  // `target` is passed in rather than read from state so this callback stays
  // stable across category changes — the seed effect below depends on it and
  // must not re-fire (and re-seed the pattern from the description, discarding
  // the user's edits) every time the dropdowns move.
  const load = useCallback(async (
    nextPattern: string | null,
    target: { categoryId: string; subcategoryId: string },
  ) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/rules/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          nextPattern === null
            ? { description, ...target }
            : { pattern: nextPattern, ...target },
        ),
      });
      if (!res.ok) throw new Error('Preview failed');
      const data = (await res.json()) as Preview;
      // Ignore this response if a newer request has since been fired, or the
      // modal has been closed — applying it now would clobber a fresher
      // preview (or set state on an unmounted component).
      if (!isMountedRef.current || requestId !== requestIdRef.current) return;
      setPreview(data);
      setPreviewKey(selectionKey(data.pattern, target.categoryId, target.subcategoryId));
      if (nextPattern === null) setPattern(data.pattern);
    } catch {
      if (isMountedRef.current && requestId === requestIdRef.current) {
        setError('Could not preview this rule.');
      }
    } finally {
      if (isMountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [description]);

  // Seed once on open — only when there is no pattern yet. With an
  // initialPattern the debounced effect below does the first preview. Uses the
  // PROPS, not the editable state, so the dependency list is constant.
  useEffect(() => {
    if (initialPattern === undefined) load(null, { categoryId, subcategoryId });
  }, [load, initialPattern, categoryId, subcategoryId]);

  // Re-preview as the pattern is edited or the target is re-pointed, on a
  // debounce. Skipped when the current preview already describes the current
  // selection — otherwise the seed effect's setPattern(data.pattern) above
  // would immediately re-trigger this effect and fire a second, redundant
  // request for the same selection.
  useEffect(() => {
    if (pattern === null) return;
    if (previewKey === selectionKey(pattern, catId, subId)) return;
    const t = setTimeout(() => { load(pattern, { categoryId: catId, subcategoryId: subId }); }, 300);
    return () => clearTimeout(t);
  }, [pattern, previewKey, catId, subId, load]);

  const category = categories.find((c) => c.id === catId);
  const subcategory = category?.subcategories.find((s) => s.id === subId);
  const categoryLabel = category && subcategory
    ? `${category.name} > ${subcategory.name}`
    : `${catId} > ${subId}`;

  // Re-point the category: the old subcategory belongs to the old category, so
  // carrying it over would produce a pair that does not exist in the taxonomy.
  const changeCategory = (id: string) => {
    setCatId(id);
    setSubId(categories.find((c) => c.id === id)?.subcategories[0]?.id ?? '');
  };

  // The preview describes the selection it was fetched for, not necessarily
  // the one on screen — those diverge for the 300ms debounce window after
  // every keystroke or dropdown change. Buttons must never commit based on a
  // preview of a different selection, so gate them on this instead of
  // `preview` directly (which only reflects whatever the last request returned).
  const previewMatchesSelection =
    pattern !== null && !!preview && previewKey === selectionKey(pattern, catId, subId);
  const risky = previewMatchesSelection && (preview!.warnHighMatchRate || preview!.warnManyCategories);
  const blocked = !previewMatchesSelection || preview!.tooShort || (risky && !confirmedWarning);

  const save = async (applyNow: boolean) => {
    if (!pattern) return;
    setSaving(true);
    setError(null);
    try {
      if (ruleId) {
        // Editing an existing rule: update the pattern, then backfill separately.
        // Applying means "enable and apply" — a disabled rule can't be backfilled,
        // so Apply must enable it. Saving a pattern edit alone must not enable it.
        const patched = await fetch(`/api/rules/${ruleId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pattern, categoryId: catId, subcategoryId: subId,
            ...(applyNow ? { enabled: true } : {}),
          }),
        });
        if (!patched.ok) {
          const body = (await patched.json()) as { error?: string };
          throw new Error(body.error ?? 'Could not save the rule');
        }
        if (applyNow) {
          const applied = await fetch(`/api/rules/${ruleId}/apply`, { method: 'POST' });
          if (!applied.ok) throw new Error('Saved the rule, but could not apply it');
        }
      } else {
        const res = await fetch('/api/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pattern, categoryId: catId, subcategoryId: subId, applyNow }),
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? 'Could not save the rule');
        }
      }
      if (applyNow) notifyDataChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the rule');
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-[var(--space-4)]"
      role="dialog"
      aria-modal="true"
      aria-label="Create a category rule"
    >
      <div className="origin-card-elevated max-h-[85vh] w-full max-w-2xl overflow-y-auto p-[var(--space-6)]">
        <h2 className="heading-xsmall text-[var(--color-text-base-default)]">
          Apply this to similar transactions?
        </h2>

        <label
          className="mt-[var(--space-4)] block text-small font-medium text-[var(--color-text-base-default)]"
          htmlFor="rule-pattern"
        >
          Description contains
        </label>
        <div className="mt-[var(--space-1)] flex flex-wrap items-center gap-[var(--space-2)]">
          <input
            id="rule-pattern"
            className="origin-input min-w-[12rem] flex-1 font-mono text-small"
            value={pattern ?? ''}
            placeholder="Loading suggestion…"
            onChange={(e) => { setPattern(e.target.value); setConfirmedWarning(false); }}
          />
          {/* Arrow and both dropdowns travel together, so a narrow modal wraps
              the whole target onto one line rather than orphaning the
              subcategory under the pattern field. */}
          <div className="flex items-center gap-[var(--space-2)]">
            <span aria-hidden="true" className="text-small text-[var(--color-text-base-subdued)]">→</span>
            <select
              aria-label="Category"
              className="origin-select text-small"
              style={{ borderLeftWidth: '3px', borderLeftColor: category?.color || '#ccc' }}
              value={catId}
              onChange={(e) => changeCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              aria-label="Subcategory"
              className="origin-select text-small"
              value={subId}
              onChange={(e) => setSubId(e.target.value)}
            >
              {category?.subcategories.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        {preview?.tooShort && (
          <p className="mt-[var(--space-3)] text-small text-[var(--color-text-critical)]">
            Enter at least 3 characters.
          </p>
        )}

        {preview && !preview.tooShort && (
          <div className="mt-[var(--space-4)] space-y-[var(--space-1)] text-small">
            <p className="text-[var(--color-text-base-default)]">
              {preview.alreadyCorrect} already {categoryLabel}
            </p>
            <p className="font-medium text-[var(--color-text-base-default)]">
              {preview.willChange} will change
            </p>
            <p className="text-[var(--color-text-base-subdued)]">
              {preview.skippedManual} skipped — you set these by hand
            </p>
          </div>
        )}

        {risky && (
          <div className="mt-[var(--space-4)] rounded-[var(--radius-2)] border border-[var(--color-text-warning)] bg-[var(--color-background-warning-subdued)] p-[var(--space-3)] text-small">
            <p className="font-medium text-[var(--color-text-base-default)]">This looks broad.</p>
            {preview!.warnHighMatchRate && (
              <p className="text-[var(--color-text-base-default)]">
                It matches {preview!.totalMatches} transactions — more than 10% of your history.
              </p>
            )}
            {preview!.warnManyCategories && (
              <p className="text-[var(--color-text-base-default)]">
                Its matches currently span {preview!.distinctCategories} different categories,
                which usually means the pattern is a payment prefix rather than one merchant.
              </p>
            )}
            <label className="mt-[var(--space-2)] flex items-center gap-[var(--space-2)] text-[var(--color-text-base-default)]">
              <input
                type="checkbox"
                checked={confirmedWarning}
                onChange={(e) => setConfirmedWarning(e.target.checked)}
              />
              I&apos;ve checked the pattern — apply it anyway
            </label>
          </div>
        )}

        {preview && preview.samples.length > 0 && (
          <ul className="mt-[var(--space-4)] divide-y divide-[var(--color-border-base-subdued)] rounded-[var(--radius-2)] border border-[var(--color-border-base-default)] text-small">
            {preview.samples.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)]"
              >
                <span className="truncate font-mono text-[var(--color-text-base-default)]">
                  {s.description}
                </span>
                <span className="whitespace-nowrap text-[var(--color-text-base-subdued)]">
                  {s.date} · {s.categoryId} &gt; {s.subcategoryId}
                </span>
              </li>
            ))}
            {preview.willChange > preview.samples.length && (
              <li className="px-[var(--space-3)] py-[var(--space-2)] text-[var(--color-text-base-subdued)]">
                … {preview.willChange - preview.samples.length} more
              </li>
            )}
          </ul>
        )}

        {error && <p className="mt-[var(--space-3)] text-small text-[var(--color-text-critical)]">{error}</p>}

        <div className="mt-[var(--space-6)] flex flex-wrap justify-end gap-[var(--space-2)]">
          <button
            className="origin-btn origin-btn-ghost"
            onClick={onClose}
            disabled={saving}
          >
            Not now
          </button>
          <button
            className="origin-btn origin-btn-secondary"
            onClick={() => save(false)}
            disabled={blocked || saving || loading}
          >
            Save for future only
          </button>
          <button
            className="origin-btn origin-btn-primary"
            onClick={() => save(true)}
            disabled={blocked || saving || loading || preview?.willChange === 0}
          >
            {saving
              ? 'Applying…'
              : `Apply to ${previewMatchesSelection ? preview!.willChange : 0} and save rule`}
          </button>
        </div>
      </div>
    </div>
  );
}
