'use client';

import { useEffect, useMemo, useState } from 'react';
import { Chart } from 'react-chartjs-2';
import type { ChartOptions, ChartData } from 'chart.js';
import '@/lib/chartConfig';
import { CHART_PALETTE, CHART_DANGER, CHART_INK, formatCurrency } from '@/lib/chartConfig';

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
      {
        type: 'line' as const, label: 'Net worth',
        data: points.map((p) => p.net),
        borderColor: CHART_INK, backgroundColor: CHART_INK,
        borderWidth: 2, tension: 0.2, pointRadius: 3, order: 0,
      },
    ],
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
          label: (c) => `${c.dataset.label}: ${formatCurrency(Math.abs(Number(c.parsed.y)))}`,
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
    <div className="origin-card-elevated p-[var(--space-6)]">
      <h2 className="heading-xsmall text-[var(--color-text-base-default)] mb-[var(--space-3)]">Net worth over time</h2>
      <div style={{ height: 320 }}>
        <Chart type="bar" data={data} options={options} />
      </div>
    </div>
  );
}
