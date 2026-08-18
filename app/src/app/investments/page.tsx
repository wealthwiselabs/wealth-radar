'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PurposeTiles from '@/app/components/investments/PurposeTiles';
import PortfolioTrendChart, { type TrendMetric } from '@/app/components/investments/PortfolioTrendChart';
import AllocationTree from '@/app/components/investments/AllocationTree';
import HoldingsBreakdown from '@/app/components/investments/HoldingsBreakdown';
import ReturnsGrid from '@/app/components/investments/ReturnsGrid';
import SyncInvestmentsButton from '@/app/components/investments/SyncInvestmentsButton';
import TimeRangeDropdown from '@/app/components/TimeRangeDropdown';
import { useTimeRange } from '@/app/hooks/useTimeRange';
import { useRefreshOnFocus } from '@/app/hooks/useRefreshOnFocus';
import { usePublishViewContext } from '@/app/hooks/usePublishViewContext';
import { PRESET_LABELS } from '@/lib/timeRange';
import type { AllocationBasis } from '@/lib/investments/periods';
import type { PurposePoint } from '@/lib/investments/series';

interface SeriesEntry {
  points: PurposePoint[];
  periodReturn: null;
}

interface Period {
  key: string;
  label: string;
}

/** Fetch JSON, turning a non-2xx or unparseable response into a thrown Error. */
async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(`Could not reach ${url}. Is the server running?`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`${url} returned a response that was not JSON (HTTP ${res.status}).`);
  }
  const data = (body ?? {}) as { error?: unknown };
  if (!res.ok) {
    const detail = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
    throw new Error(`${url} failed: ${detail}`);
  }
  return body as T;
}

export default function InvestmentsPage() {
  const [series, setSeries] = useState<Record<string, SeriesEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Shared performance basis (chart X granularity + snapshot period grid) and
  // the snapshot's selected period. The chart reads only `basis`.
  const [basis, setBasis] = useState<AllocationBasis>('monthly');
  const [metric, setMetric] = useState<TrendMetric>('value');
  const { preset, customRange, dateRange, handleChange } = useTimeRange();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getJson<{ series?: Record<string, SeriesEntry> }>('/api/investments/returns');
      setSeries(r.series ?? {});
    } catch (e) {
      // A failed request must not fall through to empty state. "$0 across the
      // board" and "the server is down" look identical otherwise.
      setSeries({});
      setError(e instanceof Error ? e.message : 'Could not load investment data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useRefreshOnFocus(load);

  /** The newest reading, or null when there is no trustworthy one. */
  const latest = (purpose: string): number | null => {
    const pts = series[purpose]?.points ?? [];
    if (pts.length === 0) return null;
    const last = pts[pts.length - 1];
    return last.accountsMissing.length > 0 ? null : last.value;
  };

  const handleBasisChange = (next: AllocationBasis) => setBasis(next);

  // Publish a compact snapshot of the portfolio headline figures + selected
  // range/basis so the assistant can "see" this page. Built from state already
  // held here; a null latest reading shows as an em dash rather than a figure.
  const viewSnapshot = useMemo(() => {
    const val = (purpose: string): string => {
      const pts = series[purpose]?.points ?? [];
      const last = pts[pts.length - 1];
      if (!last || last.accountsMissing.length > 0) return '—';
      return `$${last.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    };
    return {
      route: '/investments',
      label: 'Investments',
      timeRange: PRESET_LABELS[preset],
      filters: { basis, metric },
      highlights: [
        { label: 'Portfolio', value: val('portfolio') },
        { label: 'Education', value: val('education') },
        { label: 'Insurance', value: val('insurance') },
      ],
    };
  }, [series, preset, basis, metric]);
  usePublishViewContext(loading || error ? null : viewSnapshot);

  return (
    <main className="min-h-screen p-[var(--space-6)] max-w-6xl mx-auto">
      <div className="mb-[var(--space-6)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <h1 className="heading-large text-[var(--color-text-base-default)]">Investments</h1>
        <SyncInvestmentsButton onSynced={load} />
      </div>

      {loading ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">Loading…</p>
      ) : error ? (
        <div className="origin-card p-[var(--space-4)] border-[var(--color-border-critical)] bg-[var(--color-background-critical-subdued)]">
          <h2 className="text-small font-medium text-[var(--color-text-critical)]">Could not load investment data</h2>
          <p className="mt-[var(--space-1)] text-small text-[var(--color-text-critical)]">{error}</p>
          <p className="mt-[var(--space-2)] text-xsmall text-[var(--color-text-base-subdued)]">
            No totals are shown because none are known — this is a load failure, not an empty portfolio.
          </p>
          <button type="button" onClick={() => { void load(); }}
            className="origin-btn origin-btn-secondary mt-[var(--space-3)]">
            Retry
          </button>
        </div>
      ) : (
        <div className="space-y-[var(--space-6)]">
          <PurposeTiles summaries={[
            { purpose: 'portfolio', value: latest('portfolio') },
            { purpose: 'education', value: latest('education') },
            { purpose: 'insurance', value: latest('insurance') },
          ]} />

          <div className="flex flex-wrap items-center gap-[var(--space-3)]">
            <TimeRangeDropdown preset={preset} customRange={customRange} onChange={handleChange} />
          </div>

          <div className="flex items-center gap-[var(--space-3)] flex-wrap">
            <label htmlFor="investments-basis" className="text-small text-[var(--color-text-base-subdued)]">Basis</label>
            <select
              id="investments-basis"
              aria-label="Basis"
              className="origin-select"
              value={basis}
              onChange={(e) => handleBasisChange(e.target.value as AllocationBasis)}
            >
              <option value="monthly">Month</option>
              <option value="quarterly">Quarter</option>
              <option value="yearly">Year</option>
            </select>
            <label htmlFor="investments-metric" className="text-small text-[var(--color-text-base-subdued)] ml-[var(--space-2)]">Show</label>
            <select
              id="investments-metric"
              aria-label="Metric"
              className="origin-select"
              value={metric}
              onChange={(e) => setMetric(e.target.value as TrendMetric)}
            >
              <option value="value">Value</option>
              <option value="roi">ROI</option>
            </select>
          </div>

          <PortfolioTrendChart basis={basis} metric={metric} from={dateRange.startDate} to={dateRange.endDate} />

          <div>
            <div className="flex items-center justify-between mb-[var(--space-3)] flex-wrap gap-[var(--space-3)]">
              <h2 className="heading-xsmall text-[var(--color-text-base-default)]">
                Asset snapshot — {PRESET_LABELS[preset]}
              </h2>
            </div>
            <AllocationTree from={dateRange.startDate} to={dateRange.endDate} />
          </div>

          <HoldingsBreakdown from={dateRange.startDate} to={dateRange.endDate} />

          <ReturnsGrid
            purpose="education"
            title="Education (529)"
            basis={basis === 'monthly' ? 'monthly' : 'quarterly'}
            from={dateRange.startDate}
            to={dateRange.endDate}
          />
        </div>
      )}
    </main>
  );
}
