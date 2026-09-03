'use client';

import { useEffect, useMemo, useState } from 'react';
import { Chart } from 'react-chartjs-2';
import type { ChartOptions, ChartData } from 'chart.js';
import '@/lib/chartConfig';
import { CHART_PALETTE, CHART_DANGER, CHART_INK, formatCurrency, formatSignedCurrency } from '@/lib/chartConfig';

interface Point {
  key: string; label: string; date: string;
  assetsLiquid: number; assetsIlliquid: number; liabilities: number; net: number;
  missing: string[];
}

interface Props { from: string; to: string; basis: string; refreshKey: number }

export default function NetWorthChart({ from, to, basis, refreshKey }: Props) {
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/net-worth/series?from=${from}&to=${to}&basis=${basis}`, { cache: 'no-store' });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        if (!cancelled) { setPoints(body.points); setError(null); }
      } catch (e) {
        if (!cancelled) { setPoints([]); setError(e instanceof Error ? e.message : 'Could not load the trend.'); }
      }
    })();
    return () => { cancelled = true; };
  }, [from, to, basis, refreshKey]);

  const data: ChartData<'bar' | 'line'> = useMemo(() => ({
    labels: points.map((p) => p.label),
    datasets: [
      {
        type: 'bar' as const, label: 'Cash & investments', stack: 'assets',
        data: points.map((p) => p.assetsLiquid),
        backgroundColor: CHART_PALETTE[0], borderWidth: 0,
      },
      {
        type: 'bar' as const, label: 'Property, vehicles & other', stack: 'assets',
        data: points.map((p) => p.assetsIlliquid),
        backgroundColor: CHART_PALETTE[2], borderWidth: 0,
      },
      {
        // Negated for display only. The stored value is a positive magnitude;
        // this is the one place the sign is applied, and it is presentational.
        type: 'bar' as const, label: 'Debt', stack: 'debt',
        data: points.map((p) => -p.liabilities),
        backgroundColor: CHART_DANGER, borderWidth: 0,
      },
    ],
  }), [points]);

  // The net worth line lives on its own chart, not layered over the bars.
  // Sharing one y-axis with gross assets and debt compressed it into a nearly
  // flat band — a swing of a hundred thousand is invisible against a scale that
  // has to span -$1M to +$2.5M. On its own scale it uses the full height, so
  // the trend is actually readable. Both charts come from ONE fetch and one
  // labels array, so their x-axes stay aligned by construction.
  const trendData: ChartData<'line'> = useMemo(() => ({
    labels: points.map((p) => p.label),
    datasets: [{
      label: 'Net worth',
      data: points.map((p) => p.net),
      borderColor: CHART_INK, backgroundColor: CHART_INK,
      borderWidth: 2, tension: 0.2, pointRadius: 3,
    }],
  }), [points]);

  const trendOptions: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: { grid: { display: false } },
      // Deliberately NOT beginAtZero: this chart's job is the shape of the
      // change, and anchoring to zero would flatten it right back out. The
      // composition chart below is where absolute magnitude is read.
      y: { ticks: { callback: (v) => formatSignedCurrency(Number(v)) } },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (c) => formatSignedCurrency(Number(c.parsed.y)),
          afterBody: (items) => {
            const p = points[items[0].dataIndex];
            return p?.missing.length ? [`Excludes ${p.missing.length} unvalued item(s)`] : [];
          },
        },
      },
    },
  }), [points]);

  const options: ChartOptions<'bar' | 'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: { stacked: true, grid: { display: false } },
      // One y-axis for everything. Assets and debt share a scale so their
      // relative size is readable; a second axis would make the comparison a lie.
      y: {
        stacked: true,
        ticks: { callback: (v) => formatCurrency(Number(v)) },
      },
    },
    plugins: {
      legend: { display: true, position: 'bottom' as const },
      tooltip: {
        callbacks: {
          // The debt dataset is negated for display (see its comment above): its
          // bars sit below the axis, and position already conveys "this is owed,"
          // so Math.abs here is correct — a minus sign on top would read as a
          // double negative. Every other dataset (the two asset bars, and the net
          // worth line) is not negated for display, and can be genuinely negative
          // (an overdrawn depository account, or a net-worth deficit), so those
          // must keep their true sign. Distinguish by dataset.stack, not by the
          // number's own sign — a sign-based rule would misfire on exactly the
          // asset-side negative this is meant to reveal.
          label: (c) => {
            const raw = Number(c.parsed.y);
            const shown = c.dataset.stack === 'debt' ? formatCurrency(raw) : formatSignedCurrency(raw);
            return `${c.dataset.label}: ${shown}`;
          },
          afterBody: (items) => {
            const p = points[items[0].dataIndex];
            return p?.missing.length ? [`Excludes ${p.missing.length} unvalued item(s)`] : [];
          },
        },
      },
    },
  }), [points]);

  if (error) {
    return <p className="text-small text-[var(--color-text-critical)]">{error}</p>;
  }
  if (points.length === 0) {
    return <p className="text-small text-[var(--color-text-base-subdued)]">No readings in this range yet.</p>;
  }

  return (
    <div className="space-y-[var(--space-6)]">
      <div className="origin-card-elevated p-[var(--space-6)]">
        <h2 className="heading-xsmall text-[var(--color-text-base-default)] mb-[var(--space-3)]">
          Net worth over time
        </h2>
        <div style={{ height: 260 }}>
          <Chart type="line" data={trendData} options={trendOptions} />
        </div>
      </div>

      <div className="origin-card-elevated p-[var(--space-6)]">
        <h2 className="heading-xsmall text-[var(--color-text-base-default)]">What it&apos;s made of</h2>
        <p className="text-xsmall text-[var(--color-text-base-subdued)] mb-[var(--space-3)]">
          Assets above the line, debt below. Same months as the trend above.
        </p>
        <div style={{ height: 300 }}>
          <Chart type="bar" data={data} options={options} />
        </div>
      </div>
    </div>
  );
}
