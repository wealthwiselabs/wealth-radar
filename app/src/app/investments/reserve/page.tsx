'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import PurposeTiles from '@/app/components/investments/PurposeTiles';
import ValueTrendChart, { type TrendPoint } from '@/app/components/investments/ValueTrendChart';
import ReserveFlowsTable from '@/app/components/investments/ReserveFlowsTable';
import TimeRangeDropdown from '@/app/components/TimeRangeDropdown';
import { useTimeRange } from '@/app/hooks/useTimeRange';
import { useRefreshOnFocus } from '@/app/hooks/useRefreshOnFocus';
import { usePublishViewContext } from '@/app/hooks/usePublishViewContext';
import { usePublishSection } from '@/app/hooks/usePublishSection';
import { PRESET_LABELS } from '@/lib/timeRange';
import { formatPercent, CHART_NEUTRAL } from '@/lib/chartConfig';

interface TrendResponse {
  points: Array<{ label: string; value: number | null; roi: number | null }>;
  overall: {
    roi: number | null; gain: number | null; startValue: number | null; endValue: number | null;
    accountsCounted: number; accountsMissing: string[]; accountsInWindow: number;
  };
  from: string;
  to: string;
}

/** "2025-01-31" -> "Jan 2025" — the spec's window-subtitle date format. */
function formatMonthYear(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export default function ReservePage() {
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [value, setValue] = useState<number | null>(null);
  const [subtitle, setSubtitle] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const { preset, customRange, dateRange, handleChange } = useTimeRange();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/investments/purpose-trend?purposes=reserve&basis=monthly&from=${dateRange.startDate}&to=${dateRange.endDate}`,
      );
      if (!res.ok) {
        throw new Error(`/api/investments/purpose-trend failed: HTTP ${res.status}`);
      }
      const r: TrendResponse = await res.json();
      setPoints(r.points.map((p) => ({ label: p.label, value: p.value, roi: p.roi })));
      const complete = r.overall.accountsMissing.length === 0;
      const window = `${formatMonthYear(r.from)} – ${formatMonthYear(r.to)}`;
      setSubtitle(
        r.overall.roi === null
          ? 'ROI unavailable for this window'
          : `ROI ${formatPercent(r.overall.roi)} over ${window}${complete ? '' : ' — partial coverage, some accounts missing'}`,
      );
    } catch (e) {
      // A failed request must not fall through to the chart's empty state.
      // "No snapshots yet" and "the server is down" look identical otherwise.
      setPoints([]);
      setSubtitle('');
      setError(e instanceof Error ? e.message : 'Could not load reserve trend data.');
    }
  }, [dateRange.startDate, dateRange.endDate]);
  useEffect(() => { void load(); }, [load]);

  // The tile stays range-independent (it reports a CURRENT balance, which is
  // why the range control sits below it, not above) — a separate, unwindowed
  // purpose-trend call, so switching to e.g. Last Month never makes the tile
  // show a historical figure under a label that implies "now". An unwindowed
  // call resolves an empty `from` to the GLOBAL earliest snapshot across every
  // account (same as allocation/range under All Time), so it's exposed to the
  // same root-eligibility gap Finding 1 exists to disclose: an account whose
  // own first snapshot postdates that global `from` is dropped from endValue
  // without ever bracketing the window, so accountsMissing alone stays empty.
  // accountsCounted === accountsInWindow is the second half of the guard —
  // it catches that silent drop. Both must hold for a number to render; either
  // one failing, or the request itself failing, leaves the tile at the em
  // dash/blank rather than a plausible-looking but partial figure.
  const loadCurrentValue = useCallback(async () => {
    try {
      const res = await fetch('/api/investments/purpose-trend?purposes=reserve&basis=monthly');
      if (!res.ok) throw new Error(`/api/investments/purpose-trend failed: HTTP ${res.status}`);
      const r: TrendResponse = await res.json();
      const complete = r.overall.accountsMissing.length === 0
        && r.overall.accountsCounted === r.overall.accountsInWindow;
      setValue(complete ? r.overall.endValue : null);
    } catch {
      setValue(null);
    }
  }, []);
  useEffect(() => { void loadCurrentValue(); }, [loadCurrentValue]);

  // Bridge for the server-side background sync: it can't reach an open tab,
  // so rerun both fetches when the user returns to this one.
  const refreshAll = useCallback(() => { void load(); void loadCurrentValue(); }, [load, loadCurrentValue]);
  useRefreshOnFocus(refreshAll);

  // Publish a compact snapshot (current reserve balance + selected range) so the
  // assistant can "see" this page. A null balance shows as an em dash.
  const viewSnapshot = useMemo(() => ({
    route: '/investments/reserve',
    label: 'Reserve',
    timeRange: PRESET_LABELS[preset],
    highlights: [
      {
        label: 'Reserve balance',
        value: value == null ? '—' : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      },
    ],
  }), [preset, value]);
  usePublishViewContext(error ? null : viewSnapshot);

  usePublishSection(
    !error && points.length > 0
      ? {
          id: 'reserve.trend',
          order: 10,
          title: 'Cash reserve trend',
          summary: `Balance ${value == null ? '—' : `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}; ${points.length} points`,
          detail: { tool: 'get_portfolio_trend', args: { purpose: 'reserve', from: dateRange.startDate, to: dateRange.endDate } },
        }
      : null,
  );
  usePublishSection(
    !error
      ? {
          id: 'reserve.flows',
          order: 20,
          title: 'Reserve flows',
          summary: 'Reserve contributions and withdrawals over the selected range',
          detail: { tool: 'query_reserve', args: { from: dateRange.startDate, to: dateRange.endDate } },
        }
      : null,
  );

  return (
    <main className="min-h-screen p-[var(--space-6)] max-w-6xl mx-auto">
      <h1 className="heading-large text-[var(--color-text-base-default)] mb-[var(--space-6)]">Reserve</h1>
      <div className="space-y-[var(--space-6)]">
        {error ? (
          <div className="origin-card p-[var(--space-4)] border-[var(--color-border-critical)] bg-[var(--color-background-critical-subdued)]">
            <h2 className="text-small font-medium text-[var(--color-text-critical)]">Could not load reserve trend</h2>
            <p className="mt-[var(--space-1)] text-small text-[var(--color-text-critical)]">{error}</p>
            <p className="mt-[var(--space-2)] text-xsmall text-[var(--color-text-base-subdued)]">
              No total or chart is shown because none is known — this is a load failure, not an empty reserve.
            </p>
            <button type="button" onClick={() => { void load(); }}
              className="origin-btn origin-btn-secondary mt-[var(--space-3)]">
              Retry
            </button>
          </div>
        ) : (
          <>
            <PurposeTiles summaries={[{ purpose: 'reserve', value }]} />
            <div className="flex flex-wrap items-center gap-[var(--space-3)]">
              <TimeRangeDropdown preset={preset} customRange={customRange} onChange={handleChange} />
            </div>
            <ValueTrendChart
              title="Cash reserve"
              subtitle={subtitle}
              points={points}
              color={CHART_NEUTRAL}
              caption="A reserve return far from the money-market yield usually means a holding is assigned the wrong purpose."
            />
          </>
        )}
        <div className="origin-card-elevated p-[var(--space-6)]">
          <h2 className="heading-xsmall text-[var(--color-text-base-default)] mb-[var(--space-4)]">Flow history</h2>
          <ReserveFlowsTable from={dateRange.startDate} to={dateRange.endDate} />
        </div>
      </div>
    </main>
  );
}
