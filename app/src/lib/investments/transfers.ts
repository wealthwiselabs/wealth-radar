export interface FlowRow {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  kind: string;
  securityId?: string | null;   // set when a contribution is attributed to a security
}

const DEFAULT_WINDOW_DAYS = 5;
const MS_PER_DAY = 86_400_000;

function dayGap(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / MS_PER_DAY;
}

/**
 * Remove matched pairs of transfers between two tracked accounts.
 *
 * Moving money from Vanguard to Fidelity produces an outflow and an inflow. At
 * account level both are real; at household level counting either one destroys
 * the return, because no money entered or left the household. Pairs are matched
 * on exact offsetting amount, different accounts, and a small date window —
 * the same shape as the existing cross-source transaction dedupe.
 *
 * Matching is greedy by closest date so that N repeated transfers of the same
 * size collapse N-to-N rather than all colliding on one partner.
 */
export function netInterAccountTransfers(
  flows: FlowRow[],
  windowDays: number = DEFAULT_WINDOW_DAYS,
): FlowRow[] {
  const paired = new Set<string>();
  const outs = flows.filter((f) => f.amount < 0).sort((a, b) => a.date.localeCompare(b.date));

  for (const out of outs) {
    if (paired.has(out.id)) continue;
    const candidates = flows
      .filter((f) =>
        !paired.has(f.id) &&
        f.id !== out.id &&
        f.accountId !== out.accountId &&
        f.amount === -out.amount &&
        dayGap(f.date, out.date) <= windowDays)
      .sort((a, b) => dayGap(a.date, out.date) - dayGap(b.date, out.date));

    const partner = candidates[0];
    if (partner) {
      paired.add(out.id);
      paired.add(partner.id);
    }
  }

  return flows.filter((f) => !paired.has(f.id));
}
