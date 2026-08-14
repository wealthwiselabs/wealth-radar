/**
 * Day-weighted Modified Dietz, and the chaining of sub-period returns.
 *
 * Pure functions over plain numbers — no database access, no row shapes. The
 * caller resolves snapshots and flows and hands over scalars.
 */

export interface Flow {
  date: string;   // YYYY-MM-DD
  amount: number; // + into the account, − out
}

/**
 * A return is either a number or an explicit absence. Absence is never encoded
 * as 0 — a missing snapshot rendered as a zero return is the single most
 * dangerous failure mode in this subsystem.
 */
export type PeriodReturn =
  | { kind: 'ok'; value: number }
  | { kind: 'missing'; reason: string };

const MS_PER_DAY = 86_400_000;

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * The fraction of the period a flow was present for: 1 at the start, 0 at the
 * end. Clamped, so a flow on a boundary date cannot push the weight outside
 * [0, 1] through rounding.
 */
export function dietzWeight(flowDate: string, t0: string, t1: string): number {
  const total = daysBetween(t0, t1);
  if (total <= 0) return 0;
  const remaining = daysBetween(flowDate, t1);
  return Math.min(1, Math.max(0, remaining / total));
}

/**
 * R = (V1 − V0 − F) / (V0 + Σ Fᵢ·wᵢ)
 *
 * Contributed cash is removed from the numerator so it is never counted as
 * gain, and weighted into the denominator by how long it was actually there.
 * Weighting every flow at 1 instead reduces this to (V1−V0−F)/(V0+F), which is
 * the formula the reference spreadsheet uses.
 */
export function modifiedDietz(
  v0: number,
  v1: number,
  flows: Flow[],
  t0: string,
  t1: string,
): PeriodReturn {
  if (daysBetween(t0, t1) <= 0) {
    return { kind: 'missing', reason: 'period has no duration' };
  }

  const inPeriod = flows.filter((f) => f.date >= t0 && f.date <= t1);
  const total = inPeriod.reduce((s, f) => s + f.amount, 0);
  const weighted = inPeriod.reduce((s, f) => s + f.amount * dietzWeight(f.date, t0, t1), 0);

  const base = v0 + weighted;
  if (base === 0) {
    return { kind: 'missing', reason: 'average capital base is zero' };
  }

  return { kind: 'ok', value: (v1 - v0 - total) / base };
}

/**
 * Geometric chaining: Π(1 + rᵢ) − 1.
 *
 * A quarter built from three chained monthly returns is more accurate than one
 * three-month Dietz, because each month re-bases on its own starting value.
 * Any missing sub-period makes the whole chain missing — a quarter computed
 * from two of its three months would be silently wrong.
 */
export function chainReturns(rs: PeriodReturn[]): PeriodReturn {
  if (rs.length === 0) return { kind: 'missing', reason: 'no sub-periods' };
  let acc = 1;
  for (const r of rs) {
    if (r.kind === 'missing') return r;
    acc *= 1 + r.value;
  }
  return { kind: 'ok', value: acc - 1 };
}
