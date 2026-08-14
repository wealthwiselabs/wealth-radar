'use client';

import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import '@/lib/chartConfig';
import { formatCurrency, formatPercent } from '@/lib/chartConfig';

export interface TrendPoint {
  /** X-axis label — a period label ("Apr '26"), or a date for a date-series caller. */
  label: string;
  value: number | null;
  /** Fractional return for the period ending at this point; null when unavailable. */
  roi?: number | null;
}

interface Props {
  title: string;
  points: TrendPoint[];
  color: string;
  /** Rendered under the title — e.g. the window's overall ROI. */
  subtitle?: string;
  /** Rendered under the chart. */
  caption?: string;
}

export default function ValueTrendChart({ title, points, color, subtitle, caption }: Props) {
  const data = useMemo(() => ({
    labels: points.map((p) => p.label),
    datasets: [{
      label: title,
      // Each point already carries every account's latest value forward, so it
      // is the household's real total on that date — plot it directly. The line
      // stays continuous even when accounts are captured on different dates.
      data: points.map((p) => p.value),
      borderColor: color,
      backgroundColor: color,
      tension: 0.2,
      pointRadius: 3,
      spanGaps: false,
    }],
  }), [points, title, color]);

  const options: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    // No entry animation. In a grid/flex cell the container's width resolves a
    // tick after mount, so the first layout places points at a near-zero width;
    // with animation on, those element positions get stuck at the left edge even
    // after the axes resize to full width (the line renders as an invisible
    // sliver). Drawing without animation positions points at the current scale
    // on every draw, including the post-resize redraw.
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const roi = points[ctx.dataIndex]?.roi;
            const money = formatCurrency(ctx.parsed.y ?? 0);
            if (roi === null || roi === undefined) return `${money} · ROI unavailable`;
            return `${money} · ROI ${formatPercent(roi)}`;
          },
        },
      },
    },
    scales: {
      y: { ticks: { callback: (v) => formatCurrency(Number(v)) } },
    },
  }), [points]);

  if (points.length === 0) {
    return (
      <div className="origin-card-elevated p-[var(--space-6)]">
        <h2 className="heading-xsmall text-[var(--color-text-base-default)]">{title}</h2>
        <p className="mt-[var(--space-4)] text-small text-[var(--color-text-base-subdued)]">
          No snapshots yet. Capture one below to start the trend.
        </p>
      </div>
    );
  }

  return (
    <div className="origin-card-elevated p-[var(--space-6)]">
      <h2 className={`heading-xsmall text-[var(--color-text-base-default)] ${subtitle ? '' : 'mb-[var(--space-4)]'}`}>{title}</h2>
      {subtitle && (
        <p className="mt-[var(--space-1)] mb-[var(--space-4)] text-small text-[var(--color-text-base-subdued)]">{subtitle}</p>
      )}
      <div className="h-64">
        <Line data={data} options={options} />
      </div>
      {caption && (
        <p className="mt-[var(--space-3)] text-xsmall text-[var(--color-text-base-subdued)]">{caption}</p>
      )}
    </div>
  );
}
