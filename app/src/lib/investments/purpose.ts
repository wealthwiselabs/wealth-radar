import type { SnapshotWithHoldings } from '@/lib/investments/snapshots';

/**
 * What the money is for, as distinct from what it is invested in.
 *
 * - portfolio: 401ks, IRAs, brokerage. Residual settled cash stays here, so its
 *   drag is visible rather than hidden.
 * - reserve:   money market held deliberately as an emergency fund. Its own ROI.
 * - insurance: the IUL. Counted in total assets, excluded from ROI entirely.
 * - education: 529 college-savings accounts, earmarked for tuition. Counted in
 *   net worth, excluded from the investable portfolio, tracked on its own tile
 *   and balance/ROI section with its own ROI (like reserve).
 */
export type Purpose = 'portfolio' | 'reserve' | 'insurance' | 'education';

export const PURPOSES: Purpose[] = ['portfolio', 'reserve', 'insurance', 'education'];

export interface PurposeOverride {
  accountId: string;
  securityId: string;
  purpose: Purpose;
}

export function effectivePurpose(accountPurpose: Purpose, override?: Purpose): Purpose {
  return override ?? accountPurpose;
}

/**
 * The portion of a snapshot belonging to `target`.
 *
 * Single-purpose accounts — the common case — resolve to the reported account
 * total directly. A mixed-purpose account must sum its holdings instead, which
 * requires complete holdings; without them the split is genuinely unknowable
 * and this returns null so the caller can report `missing` rather than guess.
 */
export function purposeValue(
  snapshot: SnapshotWithHoldings,
  accountPurpose: Purpose,
  overrides: PurposeOverride[],
  target: Purpose,
): number | null {
  const mine = overrides.filter(
    (o) => o.accountId === snapshot.accountId && o.purpose !== accountPurpose,
  );

  if (mine.length === 0) {
    return accountPurpose === target ? snapshot.totalValue : 0;
  }

  if (!snapshot.holdingsComplete) return null;

  const bySecurity = new Map(mine.map((o) => [o.securityId, o.purpose]));
  return snapshot.holdings.reduce((sum, h) => {
    const p = effectivePurpose(accountPurpose, bySecurity.get(h.securityId));
    return p === target ? sum + h.value : sum;
  }, 0);
}

/**
 * Does this account hold anything of any target purpose?
 *
 * Structural, not value-derived: an account holding exactly $0 of the target
 * still counts, because it must still be required at both period boundaries.
 */
export function accountHoldsPurpose(
  accountId: string,
  accountPurpose: Purpose,
  overrides: PurposeOverride[],
  targets: readonly Purpose[],
): boolean {
  if (targets.includes(accountPurpose)) return true;
  return overrides.some((o) => o.accountId === accountId && targets.includes(o.purpose));
}

/** The subset of a snapshot's holdings whose effective purpose is in `targets`. */
export function holdingsForPurpose(
  snapshot: SnapshotWithHoldings,
  accountPurpose: Purpose,
  overrides: PurposeOverride[],
  targets: readonly Purpose[],
): SnapshotWithHoldings['holdings'] {
  const bySecurity = new Map(
    overrides.filter((o) => o.accountId === snapshot.accountId).map((o) => [o.securityId, o.purpose]),
  );
  return snapshot.holdings.filter((h) =>
    targets.includes(effectivePurpose(accountPurpose, bySecurity.get(h.securityId))));
}

/**
 * `purposeValue` summed over several targets. Null when any single target is
 * unknowable — a partial sum would silently understate the total.
 */
export function purposeValueMulti(
  snapshot: SnapshotWithHoldings,
  accountPurpose: Purpose,
  overrides: PurposeOverride[],
  targets: readonly Purpose[],
): number | null {
  let total = 0;
  for (const t of targets) {
    const v = purposeValue(snapshot, accountPurpose, overrides, t);
    if (v === null) return null;
    total += v;
  }
  return total;
}
