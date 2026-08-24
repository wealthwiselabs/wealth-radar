/**
 * Pure derivation of a purpose-trend window summary — the Start / End / Δ Value
 * / ROI header that sits above a trend chart. No chart or format dependencies,
 * so it is unit-testable under node; the component formats the raw figures.
 */

/** The `overall` block of a /api/investments/purpose-trend response. */
export interface PurposeOverall {
  roi: number | null;
  gain: number | null;
  startValue: number | null;
  endValue: number | null;
  accountsCounted: number;
  accountsMissing: string[];
  accountsInWindow: number;
}

export interface TrendSummary {
  startValue: number | null;
  endValue: number | null;
  /** endValue − startValue, or null when either endpoint is unknown. */
  valueChange: number | null;
  roi: number | null;
  /**
   * True only when the window's End total covers every account that was part of
   * the purpose during it. Two ways it can be partial: an account brackets the
   * window yet skipped it (accountsMissing), or an account reported inside the
   * window but never resolved a boundary pair (accountsCounted < accountsInWindow,
   * the silent-drop case an empty `from` exposes). Either makes End a partial
   * figure that must not be shown as the whole total.
   */
  coverageComplete: boolean;
  /** "Jan 2026 – Aug 2026". */
  windowLabel: string;
}

/** "2026-01-31" -> "Jan 2026", in UTC so the day-of-month never shifts the month. */
export function formatMonthYear(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export function summarizeWindow(overall: PurposeOverall, from: string, to: string): TrendSummary {
  const { startValue, endValue, roi } = overall;
  return {
    startValue,
    endValue,
    valueChange: startValue === null || endValue === null ? null : endValue - startValue,
    roi,
    coverageComplete:
      overall.accountsMissing.length === 0 && overall.accountsCounted === overall.accountsInWindow,
    windowLabel: `${formatMonthYear(from)} – ${formatMonthYear(to)}`,
  };
}
