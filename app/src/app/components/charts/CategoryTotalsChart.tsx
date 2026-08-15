'use client';

import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import type { ChartOptions, Plugin, TooltipItem } from 'chart.js';
import '@/lib/chartConfig';
import { formatCurrency, chartInk, CHART_NEUTRAL } from '@/lib/chartConfig';
import type { Transaction, Category } from '@/types';
import { NON_SPENDING_CATEGORIES, expenseAmount, expenseCategoryId } from '@/lib/spending';

export interface CategorySegmentClick {
  categoryId: string;
  subcategoryId?: string;
}

interface CategoryTotalsChartProps {
  transactions: Transaction[];
  categories: Category[];
  onSegmentClick?: (click: CategorySegmentClick) => void;
}

// Categories to exclude from expense tracking (not real expenses)
// Single source of truth, shared with the summary cards.
const EXCLUDED_CATEGORIES = NON_SPENDING_CATEGORIES;

// Lighten a hex color by a percentage (0-1)
function lightenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.floor((num >> 16) + (255 - (num >> 16)) * percent));
  const g = Math.min(255, Math.floor(((num >> 8) & 0x00ff) + (255 - ((num >> 8) & 0x00ff)) * percent));
  const b = Math.min(255, Math.floor((num & 0x0000ff) + (255 - (num & 0x0000ff)) * percent));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export default function CategoryTotalsChart({
  transactions,
  categories,
  onSegmentClick,
}: CategoryTotalsChartProps) {
  const chartData = useMemo(() => {
    // Filter to expenses only (negative amounts) and exclude income/transfers
    // Every row that contributes to spend, including refunds (which
    // contribute negatively). Filtering to amount < 0 here would drop refunds
    // and put these charts back out of step with the summary cards.
    const expenses = transactions.filter((t) => expenseAmount(t) !== 0);

    // Build category lookup map
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    // Group by category and subcategory
    const categoryTotals: Record<string, {
      total: number;
      subcategories: Record<string, { name: string; amount: number }>;
    }> = {};

    expenses.forEach((t) => {
      const bucket = expenseCategoryId(t);
      const category = categoryMap.get(bucket);
      const subcategory = category?.subcategories.find((s) => s.id === t.subcategoryId);

      if (!categoryTotals[bucket]) {
        categoryTotals[bucket] = { total: 0, subcategories: {} };
      }

      const amount = expenseAmount(t);   // signed: refunds subtract
      categoryTotals[bucket].total += amount;

      const subKey = t.subcategoryId;
      if (!categoryTotals[bucket].subcategories[subKey]) {
        categoryTotals[bucket].subcategories[subKey] = {
          name: subcategory?.name || t.subcategoryId,
          amount: 0,
        };
      }
      categoryTotals[bucket].subcategories[subKey].amount += amount;
    });

    // Get categories with data, sorted by total
    const sortedCategories = categories
      .filter((cat) => !EXCLUDED_CATEGORIES.includes(cat.id) && categoryTotals[cat.id]?.total > 0)
      .sort((a, b) => (categoryTotals[b.id]?.total || 0) - (categoryTotals[a.id]?.total || 0));

    // Collect all unique subcategories across all categories
    const allSubcategories = new Map<
      string,
      { categoryId: string; subcategoryId: string; name: string }
    >();
    sortedCategories.forEach((cat) => {
      Object.entries(categoryTotals[cat.id].subcategories).forEach(([subId, subData]) => {
        const key = `${cat.id}/${subId}`;
        allSubcategories.set(key, {
          categoryId: cat.id,
          subcategoryId: subId,
          name: subData.name,
        });
      });
    });

    // Create a dataset for each subcategory
    const datasets = Array.from(allSubcategories.entries()).map(
      ([key, { categoryId, subcategoryId, name }]) => {
        const category = categoryMap.get(categoryId);
        const baseColor = category?.color || CHART_NEUTRAL;

        const catSubs = Object.keys(categoryTotals[categoryId].subcategories);
        const subIdx = catSubs.indexOf(key.split('/')[1]);
        const lightenAmount = catSubs.length > 1 ? (subIdx / (catSubs.length - 1)) * 0.4 : 0;
        const color = lightenColor(baseColor, lightenAmount);

        return {
          label: name,
          data: sortedCategories.map((cat) => {
            if (cat.id !== categoryId) return 0;
            return categoryTotals[cat.id]?.subcategories[subcategoryId]?.amount || 0;
          }),
          backgroundColor: color,
          borderRadius: 0,
          categoryId,
          subcategoryId,
          subcategoryName: name,
        };
      }
    );

    return {
      labels: sortedCategories.map((cat) => cat.name),
      datasets,
      _categoryTotals: categoryTotals,
      _sortedCategories: sortedCategories,
    };
  }, [transactions, categories]);

  // Plugin: draw the per-category total at the right end of each horizontal bar.
  const totalsPlugin: Plugin<'bar'> = useMemo(
    () => ({
      id: 'categoryTotals',
      afterDatasetsDraw(chart) {
        const { ctx, data, scales } = chart;
        if (!data.labels) return;
        const xScale = scales.x;
        const yScale = scales.y;
        if (!xScale || !yScale) return;

        ctx.save();
        ctx.fillStyle = chartInk(chart.canvas);
        ctx.font = '600 11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        data.labels.forEach((_label, i) => {
          const total = data.datasets.reduce(
            (sum, ds) => sum + ((ds.data[i] as number) || 0),
            0
          );
          if (total === 0) return;
          const x = xScale.getPixelForValue(total) + 6;
          const y = yScale.getPixelForValue(i);
          ctx.fillText(formatCurrency(total), x, y);
        });
        ctx.restore();
      },
    }),
    []
  );

  const options: ChartOptions<'bar'> = useMemo(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      // Reserve right-side room so total labels don't clip on the longest bar.
      layout: { padding: { right: 80 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items: TooltipItem<'bar'>[]) => {
              const categoryIndex = items[0]?.dataIndex;
              if (categoryIndex === undefined) return '';
              const categoryName = chartData.labels[categoryIndex];
              const dataset = items[0]?.dataset as { subcategoryName?: string };
              const subcategoryName = dataset?.subcategoryName || '';
              return `${categoryName} > ${subcategoryName}`;
            },
            label: (context: TooltipItem<'bar'>) => {
              const value = context.raw as number;
              if (value === 0) return '';
              return formatCurrency(value);
            },
          },
          filter: (item: TooltipItem<'bar'>) => (item.raw as number) > 0,
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { callback: (value) => formatCurrency(value as number) },
        },
        y: {
          stacked: true,
          grid: { display: false },
        },
      },
      onClick: onSegmentClick
        ? (_event, elements) => {
            if (!elements.length) return;
            const { datasetIndex } = elements[0];
            const ds = chartData.datasets[datasetIndex] as {
              categoryId?: string;
              subcategoryId?: string;
            };
            if (ds.categoryId) {
              onSegmentClick({
                categoryId: ds.categoryId,
                subcategoryId: ds.subcategoryId,
              });
            }
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

  // Check if there are any real expenses (excluding income and transfers)
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

  // Calculate height based on number of categories
  const numCategories = chartData.labels.length;
  const height = Math.max(200, numCategories * 40);

  return (
    <div style={{ height: `${height}px` }}>
      <Bar data={chartData} options={options} plugins={[totalsPlugin]} />
    </div>
  );
}
