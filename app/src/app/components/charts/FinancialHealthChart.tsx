'use client';

import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import type { ChartOptions, ScriptableContext, TooltipItem } from 'chart.js';
import '@/lib/chartConfig';
import { formatCurrency, formatMonth, formatPercent } from '@/lib/chartConfig';
import { monthlyExpenseTotals, monthlyIncomeTotals } from '@/lib/spending';
import type { DateRange, Transaction } from '@/types';

// Palette convention shared with PortfolioTrendChart (see globals.css design
// tokens): brand green for income, critical red for spending, info blue for
// the investment return line.
const INCOME_COLOR = '#0f9d58';
const SPENDING_COLOR = '#d93025';
const RETURN_COLOR = '#4285f4';

interface GainPoint {
  month: string; // YYYY-MM
  gain: number | null;
  roi: number | null;
  accountsMissing: string[];
}

interface PurposeTrendPointJson {
  month: string;
  gain: number | null;
  roi: number | null;
  accountsMissing?: string[];
}

async function fetchGainPoints(from: string, to: string): Promise<GainPoint[]> {
  const params = new URLSearchParams({ purposes: 'portfolio,reserve,education', basis: 'monthly', from, to });
  const res = await fetch(`/api/investments/purpose-trend?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load investment return');
  const json: { points?: PurposeTrendPointJson[] } = await res.json();
  return (json.points ?? []).map((p) => ({
    month: p.month,
    gain: p.gain ?? null,
    roi: p.roi ?? null,
    accountsMissing: p.accountsMissing ?? [],
  }));
}

/**
 * Homepage-only view of financial health: monthly income, spending and
 * investment return on one dollar axis, so a month where the portfolio
 * outearned spending is visible at a glance.
 *
 * Income and spending come from the transactions the page already loaded
 * (`monthlyIncomeTotals`/`monthlyExpenseTotals` — the same functions behind
 * the summary cards, so this chart can never disagree with them). The
 * return line costs one extra request to the purpose-trend endpoint and is
 * purely supplementary: if it fails or comes back empty, the other two
 * lines still draw and nothing errors.
 */
export default function FinancialHealthChart({
  transactions,
  dateRange,
}: {
  transactions: Transaction[];
  dateRange: DateRange;
}) {
  const [gainPoints, setGainPoints] = useState<GainPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchGainPoints(dateRange.startDate ?? '', dateRange.endDate ?? '')
      .then((points) => {
        if (!cancelled) setGainPoints(points);
      })
      // Silent by design: the return line is supplementary. A failed fetch
      // just means it's absent, not an error card blocking income/spending.
      .catch(() => {
        if (!cancelled) setGainPoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dateRange.startDate, dateRange.endDate]);

  const incomeTotals = useMemo(() => monthlyIncomeTotals(transactions), [transactions]);
  const expenseTotals = useMemo(() => monthlyExpenseTotals(transactions), [transactions]);

  const chart = useMemo(() => {
    const incomeByMonth = new Map(incomeTotals.map((t) => [t.month, t.total]));
    const expenseByMonth = new Map(expenseTotals.map((t) => [t.month, t.total]));
    const gainByMonth = new Map(gainPoints.map((p) => [p.month, p]));

    // Restrict to the selected window when it's bounded — "All time" (both
    // ends empty) leaves every month any series has data for.
    const startMonth = dateRange.startDate ? dateRange.startDate.slice(0, 7) : null;
    const endMonth = dateRange.endDate ? dateRange.endDate.slice(0, 7) : null;

    const monthSet = new Set<string>([
      ...incomeByMonth.keys(),
      ...expenseByMonth.keys(),
      ...gainByMonth.keys(),
    ]);
    const months = [...monthSet]
      .filter((m) => (!startMonth || m >= startMonth) && (!endMonth || m <= endMonth))
      .sort();

    return {
      months,
      // A month a series has no entry for is `null`, not 0 — spanGaps:false
      // on each dataset turns that into a drawn gap.
      income: months.map((m) => incomeByMonth.get(m) ?? null),
      spending: months.map((m) => expenseByMonth.get(m) ?? null),
      returnValue: months.map((m) => gainByMonth.get(m)?.gain ?? null),
      gainByMonth,
    };
  }, [incomeTotals, expenseTotals, gainPoints, dateRange.startDate, dateRange.endDate]);

  const chartData = useMemo(
    () => ({
      labels: chart.months.map(formatMonth),
      datasets: [
        {
          label: 'Income',
          data: chart.income,
          borderColor: INCOME_COLOR,
          backgroundColor: INCOME_COLOR,
          borderWidth: 2,
          tension: 0.2,
          spanGaps: false,
        },
        {
          label: 'Spending',
          data: chart.spending,
          borderColor: SPENDING_COLOR,
          backgroundColor: SPENDING_COLOR,
          borderWidth: 2,
          tension: 0.2,
          spanGaps: false,
        },
        {
          label: 'Investment return',
          data: chart.returnValue,
          borderColor: RETURN_COLOR,
          backgroundColor: RETURN_COLOR,
          borderWidth: 2,
          tension: 0.2,
          spanGaps: false,
          // A month resolved over only part of the household draws a hollow
          // point instead of a solid one, so a partial return is never read
          // as the whole one — the tooltip's afterLabel spells it out too.
          pointStyle: 'circle' as const,
          pointBackgroundColor: (ctx: ScriptableContext<'line'>) => {
            const month = chart.months[ctx.dataIndex];
            const missing = chart.gainByMonth.get(month)?.accountsMissing ?? [];
            return missing.length > 0 ? 'transparent' : RETURN_COLOR;
          },
          pointBorderColor: RETURN_COLOR,
          pointRadius: (ctx: ScriptableContext<'line'>) =>
            ctx.raw === null || ctx.raw === undefined ? 0 : 4,
          pointHoverRadius: (ctx: ScriptableContext<'line'>) =>
            ctx.raw === null || ctx.raw === undefined ? 0 : 5,
        },
      ],
    }),
    [chart],
  );

  const chartOptions: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom' },
        tooltip: {
          // A null point (a gap) has nothing to say — exclude it rather
          // than showing "Investment return: $0", which would read as a
          // real figure instead of "we don't know".
          filter: (item: TooltipItem<'line'>) => item.parsed.y !== null,
          callbacks: {
            label: (ctx: TooltipItem<'line'>) => {
              const name = ctx.dataset.label ?? '';
              const value = ctx.parsed.y ?? 0;
              if (name === 'Investment return') {
                const month = chart.months[ctx.dataIndex];
                const roi = chart.gainByMonth.get(month)?.roi ?? null;
                const sign = value < 0 ? '-' : '';
                const roiStr = roi !== null ? ` (${formatPercent(roi)})` : '';
                return `${name}: ${sign}${formatCurrency(value)}${roiStr}`;
              }
              return `${name}: ${formatCurrency(value)}`;
            },
            afterLabel: (ctx: TooltipItem<'line'>) => {
              if (ctx.dataset.label !== 'Investment return') return undefined;
              const month = chart.months[ctx.dataIndex];
              const missing = chart.gainByMonth.get(month)?.accountsMissing ?? [];
              if (missing.length === 0) return undefined;
              return `${missing.length} account${missing.length === 1 ? '' : 's'} not yet reported this month`;
            },
          },
        },
      },
      scales: {
        y: {
          // The return line can go negative (a loss month); the other two
          // never do, but formatCurrency itself always strips the sign, so
          // prefix it here rather than let a negative tick read as positive.
          ticks: {
            callback: (v) => `${Number(v) < 0 ? '-' : ''}${formatCurrency(Number(v))}`,
          },
        },
      },
    }),
    [chart],
  );

  if (chart.months.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--color-text-base-subdued)]">
        No data to display
      </div>
    );
  }

  return (
    <div>
      <div className="h-64">
        <Line data={chartData} options={chartOptions} />
      </div>
      <p className="mt-[var(--space-3)] text-xsmall text-[var(--color-text-base-subdued)]">
        Hollow points mark months where some accounts had not yet reported. The return line is
        net of contributions and withdrawals; income and spending are gross cash flows, not netted
        against each other.
      </p>
    </div>
  );
}
