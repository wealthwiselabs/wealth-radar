/** A single point in a node's trend series (mirrors the /allocation/trend response). */
export interface TrendPoint {
  periodKey: string;
  label: string;
  value: number | null;
  roi: number | null;
}

/** One line's series. `key` is the node path string; '' is the Total Portfolio root. */
export interface Series {
  key: string;
  label: string;
  points: TrendPoint[];
}

/** A series aligned to a shared period axis. */
export interface MergedSeries {
  key: string;
  label: string;
  value: (number | null)[];
  roi: (number | null)[];
}

export interface MergedTrend {
  /** Period labels for the X axis, in the axis series' order. */
  labels: string[];
  /** Period keys parallel to `labels`. */
  periodKeys: string[];
  /** The axis series first, then overlays — all aligned to `periodKeys`. */
  series: MergedSeries[];
}

/**
 * Align every series onto one period axis defined by `axis` (the Total Portfolio
 * series, which spans the full range). Overlays are subsets: a period an overlay
 * lacks becomes null, which the chart draws as a gap. All series share the same
 * basis grid, so alignment is a straight lookup by periodKey.
 */
export function mergeSeries(axis: Series, overlays: Series[]): MergedTrend {
  const periodKeys = axis.points.map((p) => p.periodKey);
  const labels = axis.points.map((p) => p.label);
  const align = (s: Series): MergedSeries => {
    const byKey = new Map(s.points.map((p) => [p.periodKey, p]));
    return {
      key: s.key,
      label: s.label,
      value: periodKeys.map((k) => byKey.get(k)?.value ?? null),
      roi: periodKeys.map((k) => byKey.get(k)?.roi ?? null),
    };
  };
  return { labels, periodKeys, series: [align(axis), ...overlays.map(align)] };
}

/**
 * Period-over-period value change: (vᵢ − vᵢ₋₁) / vᵢ₋₁, as a fraction. Index 0 is
 * null (no prior period); any index whose value or prior value is null, or whose
 * prior value is 0, is null. This is a value delta — NOT net-of-contributions ROI.
 */
export function periodOverPeriodChange(values: (number | null)[]): (number | null)[] {
  return values.map((v, i) => {
    if (i === 0) return null;
    const prev = values[i - 1];
    if (v === null || prev === null || prev === 0) return null;
    return (v - prev) / prev;
  });
}
