'use client';

import { useEffect, useState } from 'react';
import ValueTrendChart, { type TrendPoint } from '@/app/components/investments/ValueTrendChart';
import { summarizeWindow, type PurposeOverall, type TrendSummary } from '@/lib/investments/trendSummary';
import { formatCurrency, formatPercent, CHART_INFO } from '@/lib/chartConfig';

interface TrendResponse {
  points: Array<{ label: string; value: number | null; roi: number | null }>;
  overall: PurposeOverall;
  from: string;
  to: string;
}

/** One labelled figure in the summary header. */
function Stat({ label, children, tone }: {
  label: string; children: React.ReactNode; tone?: string;
}) {
  return (
    <div className="min-w-[7rem]">
      <p className="text-xsmall uppercase tracking-wide text-[var(--color-text-base-subdued)]">{label}</p>
      <p className="heading-xsmall mt-[var(--space-1)]" style={{ color: tone ?? 'var(--color-text-base-default)' }}>
        {children}
      </p>
    </div>
  );
}

/** Em dash for an unknown figure — never a misleading $0 / 0%. */
const DASH = <span className="text-[var(--color-text-base-disabled)]">—</span>;

function signedTone(v: number | null): string {
  if (v === null || v === 0) return 'var(--color-text-base-subdued)';
  return v > 0 ? 'var(--color-text-success)' : 'var(--color-text-critical)';
}

/** "+$1,200.00" / "-$300.00" — sign shown textually, not by color alone. */
function signedCurrency(v: number): string {
  return `${v > 0 ? '+' : v < 0 ? '-' : ''}${formatCurrency(Math.abs(v))}`;
}

function SummaryHeader({ summary }: { summary: TrendSummary }) {
  const { startValue, endValue, valueChange, roi } = summary;
  return (
    <div className="flex flex-wrap gap-[var(--space-6)] mb-[var(--space-4)]">
      <Stat label="Start">{startValue === null ? DASH : formatCurrency(startValue)}</Stat>
      <Stat label="End">{endValue === null ? DASH : formatCurrency(endValue)}</Stat>
      <Stat label="Δ Value" tone={signedTone(valueChange)}>
        {valueChange === null ? DASH : signedCurrency(valueChange)}
      </Stat>
      <Stat label="ROI" tone={signedTone(roi)}>
        {roi === null ? DASH : formatPercent(roi)}
      </Stat>
    </div>
  );
}

/**
 * Education (529) monthly balance trend with a Start / End / Δ Value / ROI
 * header. Follows the page's time range; basis is fixed monthly — a 529 is a
 * long-horizon account, so the month is the natural grain for "each month's
 * balances". Reuses the purpose-trend endpoint and ValueTrendChart, mirroring
 * the reserve page's coverage-aware pattern.
 */
export default function EducationTrend({ from, to, refreshKey = 0 }: { from: string; to: string; refreshKey?: number }) {
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [summary, setSummary] = useState<TrendSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    fetch(`/api/investments/purpose-trend?purposes=education&basis=monthly&from=${from}&to=${to}`, { cache: 'no-store' })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((r: TrendResponse) => {
        if (cancelled) return;
        setPoints(r.points.map((p) => ({ label: p.label, value: p.value, roi: p.roi })));
        setSummary(summarizeWindow(r.overall, r.from, r.to));
      })
      .catch((e) => {
        if (cancelled) return;
        // A failed request must not fall through to the chart's empty state —
        // "no 529 snapshots yet" and "the server is down" look identical otherwise.
        setPoints([]); setSummary(null);
        setError(e instanceof Error ? e.message : 'Could not load education trend.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to, refreshKey]);

  const subtitle = summary
    ? (summary.roi === null
        ? `Balance over ${summary.windowLabel}`
        : `ROI ${formatPercent(summary.roi)} over ${summary.windowLabel}`)
      + (summary.coverageComplete ? '' : ' — partial coverage, some accounts missing')
    : undefined;

  // Loading / error / empty share one card so the section keeps its shape; the
  // data state hands off to ValueTrendChart, which is itself the card (title +
  // subtitle + the summary header, then the monthly line).
  if (loading || error || points.length === 0) {
    return (
      <div className="origin-card-elevated p-[var(--space-6)]">
        <h2 className="heading-xsmall text-[var(--color-text-base-default)]">Education (529)</h2>
        <p className={`mt-[var(--space-4)] text-small ${error ? 'text-[var(--color-text-critical)]' : 'text-[var(--color-text-base-subdued)]'}`}>
          {loading ? 'Loading…' : error ? error : 'No 529 snapshots in this window yet.'}
        </p>
      </div>
    );
  }

  return (
    <ValueTrendChart
      title="Education (529)"
      subtitle={subtitle}
      header={summary ? <SummaryHeader summary={summary} /> : undefined}
      points={points}
      color={CHART_INFO}
    />
  );
}
