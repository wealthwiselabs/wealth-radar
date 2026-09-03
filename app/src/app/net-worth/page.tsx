'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TimeRangeDropdown from '@/app/components/TimeRangeDropdown';
import { useTimeRange } from '@/app/hooks/useTimeRange';
import { useRefreshOnFocus } from '@/app/hooks/useRefreshOnFocus';
import { onDataChanged } from '@/lib/dataEvents';
import { formatCurrency, formatSignedCurrency } from '@/lib/chartConfig';
import { usePublishViewContext } from '@/app/hooks/usePublishViewContext';
import { PRESET_LABELS } from '@/lib/timeRange';
import NetWorthChart from '@/app/components/netWorth/NetWorthChart';
import NetWorthWaterfall from '@/app/components/netWorth/NetWorthWaterfall';
import StaleStrip from '@/app/components/netWorth/StaleStrip';
import BalanceSheet from '@/app/components/netWorth/BalanceSheet';
import MissedItemsHint from '@/app/components/netWorth/MissedItemsHint';

export interface RegisterRow {
  accountId: string;
  name: string;
  side: 'asset' | 'liability';
  group: string;
  /** Waterfall bucket for liabilities (e.g. 'Credit cards'); null for assets. */
  debtGroup: string | null;
  value: number | null;
  lastAsOf: string | null;
  source: string | null;
  reviewIntervalMonths: number | null;
  securedByAccountId: string | null;
  valueLow: number | null;
  valueHigh: number | null;
  valuationRef: string | null;
  canDelete: boolean;
}

export interface Totals {
  assetsLiquid: number; assetsIlliquid: number; assets: number;
  liabilities: number; net: number; missing: string[];
}

export default function NetWorthPage() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { preset, customRange, dateRange, handleChange } = useTimeRange();
  const didInitialLoad = useRef(false);

  const load = useCallback(async () => {
    const initial = !didInitialLoad.current;
    if (initial) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/net-worth', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`);
      setTotals(body.totals);
      setRows(body.rows);
      setProviderConfigured(Boolean(body.providerConfigured));
    } catch (e) {
      // A failed request must not fall through to an empty balance sheet.
      // "$0 net worth" and "the server is down" look identical otherwise.
      setTotals(null);
      setRows([]);
      setError(e instanceof Error ? e.message : 'Could not load net worth.');
    } finally {
      didInitialLoad.current = true;
      if (initial) setLoading(false);
    }
  }, []);

  const refreshAll = useCallback(() => {
    setRefreshKey((k) => k + 1);
    void load();
  }, [load]);

  useEffect(() => { refreshAll(); }, [refreshAll]);
  useRefreshOnFocus(refreshAll);
  useEffect(() => onDataChanged(refreshAll), [refreshAll]);

  // Publish the balance-sheet headline figures so the assistant can "see"
  // this page, mirroring the Investments page's viewSnapshot.
  const viewSnapshot = useMemo(() => totals ? ({
    route: '/net-worth',
    label: 'Net worth',
    timeRange: PRESET_LABELS[preset],
    highlights: [
      { label: 'Net worth', value: formatSignedCurrency(totals.net) },
      { label: 'Assets', value: formatCurrency(totals.assets) },
      { label: 'Liabilities', value: formatCurrency(totals.liabilities) },
    ],
  }) : null, [totals, preset]);
  usePublishViewContext(loading || error ? null : viewSnapshot);

  return (
    <main className="min-h-screen p-[var(--space-6)] max-w-6xl mx-auto">
      <h1 className="heading-large text-[var(--color-text-base-default)] mb-[var(--space-6)]">Net worth</h1>

      {loading ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">Loading…</p>
      ) : error ? (
        <div className="origin-card p-[var(--space-4)] border-[var(--color-border-critical)] bg-[var(--color-background-critical-subdued)]">
          <h2 className="text-small font-medium text-[var(--color-text-critical)]">Could not load net worth</h2>
          <p className="mt-[var(--space-1)] text-small text-[var(--color-text-critical)]">{error}</p>
          <p className="mt-[var(--space-2)] text-xsmall text-[var(--color-text-base-subdued)]">
            No figure is shown because none is known — this is a load failure, not an empty balance sheet.
          </p>
          <button type="button" onClick={() => { void load(); }} className="origin-btn origin-btn-secondary mt-[var(--space-3)]">
            Retry
          </button>
        </div>
      ) : totals ? (
        <div className="space-y-[var(--space-6)]">
          <div className="origin-card-elevated p-[var(--space-6)]">
            <p className="text-small text-[var(--color-text-base-subdued)]">Net worth</p>
            <p className="heading-large text-[var(--color-text-base-default)] tabular-nums">
              {formatSignedCurrency(totals.net)}
            </p>

            <div className="mt-[var(--space-5)] flex flex-wrap gap-[var(--space-6)]">
              <div>
                <p className="text-xsmall text-[var(--color-text-base-subdued)]">Assets</p>
                <p className="heading-xsmall text-[var(--color-text-base-default)] tabular-nums">
                  {formatCurrency(totals.assets)}
                </p>
              </div>
              <div>
                <p className="text-xsmall text-[var(--color-text-base-subdued)]">Liabilities</p>
                <p className="heading-xsmall text-[var(--color-text-base-default)] tabular-nums">
                  {formatCurrency(totals.liabilities)}
                </p>
              </div>
              {totals.assets > 0 && (
                <div>
                  <p className="text-xsmall text-[var(--color-text-base-subdued)]">Debt to assets</p>
                  <p className="heading-xsmall text-[var(--color-text-base-default)] tabular-nums">
                    {Math.round((totals.liabilities / totals.assets) * 100)}%
                  </p>
                </div>
              )}
            </div>
          </div>

          {totals.missing.length > 0 && (
            /* Never absorbed as zero. The total is real but incomplete, and
               saying which items are missing is what keeps it honest. */
            <div className="origin-card p-[var(--space-3)]">
              <p className="text-small text-[var(--color-text-base-default)]">
                This excludes {totals.missing.length} item{totals.missing.length === 1 ? '' : 's'} you
                haven&apos;t valued yet: {totals.missing.join(', ')}.
              </p>
            </div>
          )}

          <TimeRangeDropdown preset={preset} customRange={customRange} onChange={handleChange} />

          <NetWorthChart from={dateRange.startDate} to={dateRange.endDate} basis="monthly" refreshKey={refreshKey} />
          <NetWorthWaterfall rows={rows} />
          <StaleStrip refreshKey={refreshKey} />
          <BalanceSheet rows={rows} onChanged={refreshAll} providerConfigured={providerConfigured} />
          <MissedItemsHint rows={rows} />
        </div>
      ) : null}
    </main>
  );
}
