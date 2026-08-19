'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import '@/lib/chartConfig';
import { formatCurrency, formatPercent, CHART_PALETTE, CHART_INK } from '@/lib/chartConfig';
import type { AllocNode } from '@/lib/investments/allocation';
import type { AllocationBasis } from '@/lib/investments/periods';
import {
  mergeSeries,
  periodOverPeriodChange,
  type Series,
} from '@/lib/investments/portfolioTrend';
import { usePublishSection } from '@/app/hooks/usePublishSection';

export type TrendMetric = 'value' | 'roi';

// Cascading picker levels — same Class→Region→Cap→Style mechanic as the tree.
const LEVEL_LABELS = ['Class', 'Region', 'Cap', 'Style'] as const;
const LEVEL_COUNT = LEVEL_LABELS.length;

// Baseline "total" line is pinned to the ink color; the category series use the
// shared Heirloom chart palette (see chartConfig.ts) so charts read as part of
// the same theme as the rest of the app.
const TOTAL_COLOR = CHART_INK;
const PALETTE = CHART_PALETTE;

const PERIOD_WORD: Record<AllocationBasis, string> = {
  monthly: 'month',
  quarterly: 'quarter',
  yearly: 'year',
};

interface Overlay {
  /** Path key: labels joined by '/', matching the trend endpoint's `path` param. */
  path: string[];
  /** Display label: labels joined by ' · '. */
  label: string;
}

/** Walk `tree` down `labels`, returning the node reached or null if any hop misses. */
function nodeAtPrefix(tree: AllocNode, labels: string[]): AllocNode | null {
  let node: AllocNode = tree;
  for (const label of labels) {
    const next = node.children.find((c) => c.label === label);
    if (!next) return null;
    node = next;
  }
  return node;
}

async function fetchSeries(
  basis: AllocationBasis,
  path: string[],
  label: string,
  from: string,
  to: string,
): Promise<Series> {
  const res = await fetch(
    `/api/investments/allocation/trend?basis=${basis}&path=${path.join('/')}&from=${from}&to=${to}`,
  );
  if (!res.ok) throw new Error('Failed to load trend');
  const json: { points?: Series['points'] } = await res.json();
  return { key: path.join('/'), label, points: json.points ?? [] };
}

export default function PortfolioTrendChart({
  basis,
  metric,
  from,
  to,
}: {
  basis: AllocationBasis;
  metric: TrendMetric;
  from: string;
  to: string;
}) {
  const [tree, setTree] = useState<AllocNode | null>(null);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [ready, setReady] = useState(false);
  const seededRef = useRef(false);
  const [selections, setSelections] = useState<string[]>(() => Array(LEVEL_COUNT).fill(''));
  const [merged, setMerged] = useState<ReturnType<typeof mergeSeries> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Intentional second fetch of /api/investments/allocation: the parent /investments
  // page independently fetches this endpoint for the snapshot grid, and this component
  // fetches it separately for its picker tree. The two are decoupled by design to keep
  // the picker independent; do not dedupe one away or the picker loses its options.
  // Fetch the tree once per basis to populate the cascading picker. Empty period
  // ⇒ the endpoint returns the latest period's tree, which is all we need for the
  // available labels. Guarded so a superseded basis change can't apply stale.
  // The pinned Total line does not depend on the tree at all — it is only used for
  // the cascading picker — so `ready` (gating the trend fetch below) must be set
  // regardless of whether a tree comes back. Default overlay seeding (Stock/Bond)
  // happens at most once, the first time a non-null tree arrives.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/investments/allocation?basis=${basis}&period=`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('tree'))))
      .then((json: { tree: AllocNode | null }) => {
        if (cancelled) return;
        setTree(json.tree);
        if (!seededRef.current && json.tree) {
          const seeds = ['Stock', 'Bond']
            .filter((label) => json.tree!.children.some((c) => c.label === label))
            .map((label) => ({ path: [label], label }));
          if (seeds.length > 0) setOverlays(seeds);
          seededRef.current = true;
        }
        setReady(true);
      })
      .catch(() => {
        /* leave prior tree; the trend fetch below surfaces load errors */
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [basis]);

  // The set of lines to plot: pinned Total (path []) + overlays. Fetch each and
  // merge onto the Total axis. Re-runs on basis or overlay changes.
  const overlayKey = overlays.map((o) => o.path.join('/')).join('|');
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    Promise.all([
      fetchSeries(basis, [], 'Total Portfolio', from, to),
      ...overlays.map((o) => fetchSeries(basis, o.path, o.label, from, to)),
    ])
      .then(([total, ...rest]) => {
        if (cancelled) return;
        setMerged(mergeSeries(total, rest));
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load trend.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, basis, overlayKey, from, to]);

  const handleLevelChange = (level: number, value: string) => {
    setSelections((prev) => {
      const next = [...prev];
      next[level] = value;
      for (let i = level + 1; i < LEVEL_COUNT; i++) next[i] = '';
      return next;
    });
  };

  const addOverlay = () => {
    const path = selections.filter(Boolean);
    if (path.length === 0) return;
    const key = path.join('/');
    if (overlays.some((o) => o.path.join('/') === key)) return;
    setOverlays((prev) => [...prev, { path, label: path.join(' · ') }]);
  };

  const removeOverlay = (key: string) => {
    setOverlays((prev) => prev.filter((o) => o.path.join('/') !== key));
  };

  // Per-dataset period-over-period change, aligned to points, for the tooltip.
  const pctChange = useMemo(
    () => (merged ? merged.series.map((s) => periodOverPeriodChange(s.value)) : []),
    [merged],
  );

  const colorFor = (index: number) => (index === 0 ? TOTAL_COLOR : PALETTE[(index - 1) % PALETTE.length]);

  const chartData = useMemo(() => {
    if (!merged) return { labels: [], datasets: [] };
    return {
      labels: merged.labels,
      datasets: merged.series.map((s, i) => ({
        label: s.label,
        data: (metric === 'value' ? s.value : s.roi.map((r) => (r === null ? null : r * 100))),
        borderColor: colorFor(i),
        backgroundColor: colorFor(i),
        borderWidth: i === 0 ? 3 : 2,
        tension: 0.2,
        spanGaps: false,
      })),
    };
  }, [merged, metric]);

  const chartOptions: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false, // see ValueTrendChart: avoid the left-edge strand on late width resolve
      plugins: {
        legend: { display: true, position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const name = ctx.dataset.label ?? '';
              if (metric === 'roi') {
                return `${name}: ${formatPercent((ctx.parsed.y ?? 0) / 100)}`;
              }
              const change = pctChange[ctx.datasetIndex]?.[ctx.dataIndex] ?? null;
              const base = `${name}: ${formatCurrency(ctx.parsed.y ?? 0)}`;
              if (change === null) return base;
              return `${base} (${formatPercent(change)} vs prev ${PERIOD_WORD[basis]})`;
            },
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: (v) =>
              metric === 'value' ? formatCurrency(Number(v)) : formatPercent(Number(v) / 100),
          },
        },
      },
    }),
    [metric, pctChange, basis],
  );

  usePublishSection(
    merged
      ? {
          id: 'investments.trend',
          order: 10,
          title: 'Portfolio trend',
          summary: `${merged.series.length} series (${merged.series.map((s) => s.label).join(', ')}); ${
            merged.labels[0] ?? ''}–${merged.labels[merged.labels.length - 1] ?? ''}; metric ${metric}`,
          detail: { tool: 'get_portfolio_trend', args: { basis, from, to, metric } },
        }
      : null,
  );

  return (
    <div className="origin-card-elevated p-[var(--space-4)]">
      <div className="flex items-center justify-between mb-[var(--space-4)] flex-wrap gap-[var(--space-3)]">
        {/* Scope note, not decoration: each point counts only the accounts that
            had reported by that date, so this line can sit well below the Total
            Investments tile until a recently-added account has its first
            snapshot. Without this the gap reads as a bug. */}
        <h2
          className="heading-xsmall text-[var(--color-text-base-default)]"
          title="Each month counts only the accounts that had reported by then. Accounts added recently — the 529s, Morgan Stanley — are absent from earlier months, so this line sits below Total Investments until they have reported."
        >
          Portfolio trend
          <span
            aria-hidden="true"
            className="ml-[var(--space-1)] text-[var(--color-text-base-disabled)] cursor-help"
          >
            ⓘ
          </span>
        </h2>
        <div className="flex items-center gap-[var(--space-2)] flex-wrap">
          {LEVEL_LABELS.map((levelLabel, level) => {
            const options = tree
              ? nodeAtPrefix(tree, selections.slice(0, level))?.children.map((c) => c.label) ?? []
              : [];
            return (
              <select
                key={levelLabel}
                aria-label={levelLabel}
                className="origin-select"
                value={selections[level]}
                disabled={options.length === 0}
                onChange={(e) => handleLevelChange(level, e.target.value)}
              >
                <option value="">—</option>
                {options.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            );
          })}
          <button
            type="button"
            className="origin-btn origin-btn-secondary"
            disabled={selections.filter(Boolean).length === 0}
            onClick={addOverlay}
          >
            Add line
          </button>
        </div>
      </div>

      <div className="mb-[var(--space-3)] flex items-center gap-[var(--space-2)] flex-wrap">
        <span
          className="inline-flex items-center gap-[var(--space-1)] text-xsmall text-[var(--color-text-base-subdued)]"
        >
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: TOTAL_COLOR }} aria-hidden="true" />
          Total Portfolio
        </span>
        {overlays.map((o, i) => {
          const key = o.path.join('/');
          return (
            <span
              key={key}
              className="inline-flex items-center gap-[var(--space-1)] rounded-full px-[var(--space-2)] py-[var(--space-1)] text-xsmall bg-[var(--color-background-base-subdued)]"
            >
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ background: colorFor(i + 1) }}
                aria-hidden="true"
              />
              {o.label}
              <button
                type="button"
                onClick={() => removeOverlay(key)}
                aria-label={`Remove ${o.label}`}
                className="ml-[var(--space-1)] text-[var(--color-text-base-subdued)]"
              >
                ✕
              </button>
            </span>
          );
        })}
      </div>

      {isLoading ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">Loading trend…</p>
      ) : error ? (
        <p className="text-small text-[var(--color-text-critical)]">{error}</p>
      ) : !merged || merged.labels.length === 0 ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">No trend data yet.</p>
      ) : (
        <div className="h-64">
          <Line data={chartData} options={chartOptions} />
        </div>
      )}
    </div>
  );
}
