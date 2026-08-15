'use client';

import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import type { ChartOptions, Plugin } from 'chart.js';
import '@/lib/chartConfig';
import { formatCurrency, formatMonth, chartInk } from '@/lib/chartConfig';
import type { Transaction, Category } from '@/types';
import { NON_SPENDING_CATEGORIES, expenseAmount, expenseCategoryId } from '@/lib/spending';

export interface MonthSegmentClick {
  month: string; // YYYY-MM
  categoryId?: string;
}

interface MonthlyExpensesChartProps {
  transactions: Transaction[];
  categories: Category[];
  onSegmentClick?: (click: MonthSegmentClick) => void;
}

// Categories to exclude from expense tracking (not real expenses)
// Single source of truth, shared with the summary cards.
const EXCLUDED_CATEGORIES = NON_SPENDING_CATEGORIES;

export default function MonthlyExpensesChart({
  transactions,
  categories,
  onSegmentClick,
}: MonthlyExpensesChartProps) {
  const chartData = useMemo(() => {
    // Every row that contributes to spend, including refunds (which
    // contribute negatively). Filtering to amount < 0 here would drop refunds
    // and put these charts back out of step with the summary cards.
    const expenses = transactions.filter((t) => expenseAmount(t) !== 0);

    const monthlyData: Record<string, Record<string, number>> = {};
    expenses.forEach((t) => {
      const month = t.date.substring(0, 7);
      const bucket = expenseCategoryId(t);
      if (!monthlyData[month]) monthlyData[month] = {};
      if (!monthlyData[month][bucket]) monthlyData[month][bucket] = 0;
      monthlyData[month][bucket] += expenseAmount(t);
    });

    const months = Object.keys(monthlyData).sort();

    const activeCategories = categories.filter(
      (cat) =>
        !EXCLUDED_CATEGORIES.includes(cat.id) &&
        months.some((month) => monthlyData[month]?.[cat.id])
    );

    const datasets = activeCategories.map((cat) => ({
      label: cat.name,
      data: months.map((month) => monthlyData[month]?.[cat.id] || 0),
      backgroundColor: cat.color,
      borderRadius: 4,
      // Custom field used by onClick handler to map dataset → categoryId.
      categoryId: cat.id,
    }));

    return {
      labels: months.map(formatMonth),
      datasets,
      _monthKeys: months, // raw YYYY-MM, parallel to labels
    };
  }, [transactions, categories]);

  // Plugin: draw the monthly total above each stacked bar.
  const totalsPlugin: Plugin<'bar'> = useMemo(
    () => ({
      id: 'monthlyTotals',
      afterDatasetsDraw(chart) {
        const { ctx, data, scales } = chart;
        if (!data.labels) return;
        const yScale = scales.y;
        const xScale = scales.x;
        if (!yScale || !xScale) return;

        ctx.save();
        ctx.fillStyle = chartInk(chart.canvas);
        ctx.font = '600 11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        data.labels.forEach((_label, i) => {
          // Only datasets currently drawn — isolating a category via the legend
          // must not leave the all-category total floating above a single bar.
          const total = data.datasets.reduce(
            (sum, ds, di) =>
              chart.isDatasetVisible(di) ? sum + ((ds.data[i] as number) || 0) : sum,
            0
          );
          if (total === 0) return;
          const x = xScale.getPixelForValue(i);
          const y = yScale.getPixelForValue(total) - 4;
          ctx.fillText(formatCurrency(total), x, y);
        });
        ctx.restore();
      },
    }),
    []
  );

  const options: ChartOptions<'bar'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      // Reserve a little headroom so the total label doesn't clip on the largest bar.
      layout: { padding: { top: 18 } },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, padding: 15, font: { size: 11 } },
          // Chart.js's default is to HIDE the clicked series, which is the
          // wrong way round when you have a dozen stacked categories: reading
          // one of them would mean clicking the other eleven. Clicking isolates
          // instead, and clicking the isolated one again restores everything.
          onClick: (_event, item, legend) => {
            const chart = legend.chart;
            const clicked = item.datasetIndex;
            if (clicked == null) return;
            const metas = chart.data.datasets.map((_, i) => chart.getDatasetMeta(i));
            const alreadyIsolated = metas.every((m, i) => (i === clicked ? !m.hidden : !!m.hidden));
            metas.forEach((m, i) => { m.hidden = alreadyIsolated ? false : i !== clicked; });
            chart.update();
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const value = context.raw as number;
              return `${context.dataset.label}: ${formatCurrency(value)}`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true,
          ticks: { callback: (value) => formatCurrency(value as number) },
        },
      },
      onClick: onSegmentClick
        ? (_event, elements) => {
            if (!elements.length) return;
            const { datasetIndex, index } = elements[0];
            const month = chartData._monthKeys[index];
            const categoryId = (
              chartData.datasets[datasetIndex] as { categoryId?: string }
            ).categoryId;
            if (month) onSegmentClick({ month, categoryId });
          }
        : undefined,
      onHover: onSegmentClick
        ? (event, elements) => {
            const target = event.native?.target as HTMLElement | undefined;
            if (target) target.style.cursor = elements.length ? 'pointer' : 'default';
          }
        : undefined,
    }),
    [chartData, onSegmentClick]
  );

  const hasExpenses = transactions.some(
    (t) => t.amount < 0 && !EXCLUDED_CATEGORIES.includes(t.categoryId)
  );

  if (!hasExpenses) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--color-text-base-subdued)]">
        No expense data to display
      </div>
    );
  }

  return (
    <div className="h-[28rem]">
      <Bar data={chartData} options={options} plugins={[totalsPlugin]} />
    </div>
  );
}
