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
// and can't read CSS variables, so this module is where chart colors live —
// update here when the theme changes. The one exception is per-category
// spending colors, which belong to the category and so live in
// data/taxonomy.json; those are drawn from the same Heirloom family.
export const CHART_PALETTE = ['#1e4d2b', '#b45309', '#2c7a7b', '#9b2c2c', '#6b8e4e', '#5b7fa6'];

// Calm single-series trend color (e.g. cash reserve), also the fallback for a
// series with no color of its own.
export const CHART_NEUTRAL = '#8a8266';

/* Canvas mirrors of the semantic theme tokens, for the charts that encode
   meaning rather than category: money up, money down, a supplementary
   reference line, and the ink used for baselines and drawn-on labels. */
export const CHART_SUCCESS = '#2f7a44'; // matches --p-success
export const CHART_DANGER = '#b91c1c';  // matches --p-danger
export const CHART_INFO = '#1f6f78';    // matches --p-info
export const CHART_INK = '#2a2a20';     // matches --p-ink

/**
 * The current text color, for labels a plugin draws onto the canvas.
 *
 * Series colors are fixed hexes (above) because a data series must mean the
 * same thing in either scheme. Drawn-on *text* is different: it is chrome, and
 * chrome that stays ink-dark disappears against the dark theme's ground. This
 * is safe to resolve here because plugins draw on every frame, so the value is
 * re-read after a scheme change; CHART_INK is the fallback for SSR and for the
 * canvas-in-a-detached-node case, where there is no computed style to read.
 */
export function chartInk(canvas?: HTMLCanvasElement | null): string {
  if (typeof window === 'undefined') return CHART_INK;
  const el = canvas ?? document.body;
  const value = getComputedStyle(el).getPropertyValue('--color-text-base-default').trim();
  return value || CHART_INK;
}

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
