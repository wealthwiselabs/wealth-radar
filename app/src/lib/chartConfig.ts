import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  LineElement,
  PointElement,
  LineController,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  LineElement,
  PointElement,
  LineController
);

// Categorical series colors, tuned to sit alongside the Heirloom palette
// (pine, clay/gold, teal, wine, sage, dusty blue). Chart.js draws to a canvas
// and can't read CSS variables, so these are the one place chart colors live —
// update here when the theme changes.
export const CHART_PALETTE = ['#1e4d2b', '#b45309', '#2c7a7b', '#9b2c2c', '#6b8e4e', '#5b7fa6'];

// Calm single-series trend color (e.g. cash reserve).
export const CHART_NEUTRAL = '#8a8266';

// Common chart options
export const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: {
        usePointStyle: true,
        padding: 20,
      },
    },
  },
};

// Format currency for tooltips
export function formatCurrency(value: number): string {
  return Math.abs(value).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/**
 * A signed percentage from a raw return fraction (0.0523 -> "+5.2%").
 * Positive values get an explicit "+" so a gain reads unambiguously in a dense
 * grid; zero is neutral (no forced sign).
 */
export function formatPercent(fraction: number, digits = 1): string {
  const pct = fraction * 100;
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
  const absValue = Math.abs(pct);
  const divisor = Math.pow(10, digits);
  const rounded = Math.round(absValue * divisor) / divisor;
  return `${sign}${rounded.toFixed(digits)}%`;
}

// Get month label from YYYY-MM format
export function formatMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}
