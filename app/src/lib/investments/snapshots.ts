import { eq, and, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { resolveOrCreateSecurity, type SecurityKind, type AssetType } from '@/lib/investments/securities';

type Db = ReturnType<typeof getDb>;

/** A position as parsed or entered, before it is tied to a security row. */
export interface ParsedHolding {
  ticker: string | null;
  name: string;
  quantity: number | null;
  value: number;
  // Optional classification the source already knows (e.g. Plaid maps each
  // security's type). When present it is forwarded to resolveOrCreateSecurity so
  // the security row is tagged on first sight; the paste path omits these and
  // falls back to the resolver's defaults, so this is backward compatible.
  kind?: SecurityKind;
  assetType?: AssetType;
  tagSource?: string;
}

export interface Reconciliation {
  holdingsSum: number;
  delta: number;
  withinTolerance: boolean;
}

/**
 * Thrown when holdings disagree with the reported account total and the caller
 * has not acknowledged the mismatch.
 *
 * A distinct type because this is the one failure the user can fix themselves:
 * the API maps it to 409 and shows the message. Every other throw out of
 * `commitSnapshot` — a constraint violation, a disk error — is a server fault
 * and must not be dressed up as user error, which is exactly what matching on
 * the message text used to do.
 */
export class ReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconciliationError';
  }
}

/** A dollar of slack, plus a basis point of the total, absorbs broker rounding. */
const ABSOLUTE_TOLERANCE = 1;
const RELATIVE_TOLERANCE = 0.0001;

export function monthOfDate(d: string): string {
  return d.slice(0, 7);
}

/**
 * Compare the holdings sum against the account total the institution reported.
 *
 * An empty holdings list is "no claim made", not "the account is worth zero" —
 * total-only snapshots are a supported shape (the IUL, some 401k portals).
 */
export function reconcile(totalValue: number, holdings: ParsedHolding[]): Reconciliation {
  const holdingsSum = holdings.reduce((s, h) => s + h.value, 0);
  if (holdings.length === 0) {
    return { holdingsSum: 0, delta: 0, withinTolerance: true };
  }
  const delta = holdingsSum - totalValue;
  const allowed = ABSOLUTE_TOLERANCE + Math.abs(totalValue) * RELATIVE_TOLERANCE;
  return { holdingsSum, delta, withinTolerance: Math.abs(delta) <= allowed };
}

export interface CommitSnapshotInput {
  accountId: string;
  asOf: string;
  source: string;
  totalValue: number;
  holdings?: ParsedHolding[];
  note?: string;
  /** Commit anyway when holdings disagree with the reported total. */
  acknowledgeMismatch?: boolean;
}

export interface SnapshotWithHoldings {
  id: string;
  accountId: string;
  asOf: string;
  month: string;
  source: string;
  totalValue: number;
  holdingsComplete: boolean;
  holdings: Array<{ securityId: string; quantity: number | null; value: number }>;
}

/** A holding after its security row exists, ready to insert. */
interface ResolvedHolding {
  securityId: string;
  quantity: number | null;
  value: number;
}

/**
 * Collapse holdings that resolved onto the same security row.
 *
 * `snapshot_holdings` is UNIQUE(snapshot_id, security_id), and a single paste
 * legitimately lists one instrument twice — two tax lots, or a fund appearing
 * in both the employee and employer sides of a 401k. Those are the same
 * position reported in pieces, so the value sums.
 *
 * Quantity only sums when every contributing row supplied one: a share count
 * covering some of the position is a wrong number, and a wrong number is worse
 * than an honest null.
 */
function aggregateHoldings(resolved: ResolvedHolding[]): ResolvedHolding[] {
  const merged = new Map<string, ResolvedHolding>();
  for (const h of resolved) {
    const prior = merged.get(h.securityId);
    if (!prior) {
      merged.set(h.securityId, { ...h });
      continue;
    }
    prior.value += h.value;
    prior.quantity =
      prior.quantity === null || h.quantity === null ? null : prior.quantity + h.quantity;
  }
  return [...merged.values()];
}

/**
 * Write one snapshot and its holdings. Re-committing the same (account, date)
 * replaces the prior snapshot outright rather than merging, so a corrected
 * paste fully supersedes a bad one and leaves no orphan holdings behind.
 *
 * The replacement is atomic. Securities are resolved first, outside the
 * transaction, because better-sqlite3 transactions are synchronous and cannot
 * contain an `await`; every destructive step then happens inside one
 * transaction so a failure mid-write cannot leave the account with the prior
 * snapshot deleted and a truncated one marked complete in its place.
 */
export async function commitSnapshot(
  input: CommitSnapshotInput,
  db: Db = getDb(),
): Promise<{ snapshotId: string; reconciliation: Reconciliation }> {
  const holdings = input.holdings ?? [];
  // Reconciliation runs on the caller's raw rows, before aggregation. The sum
  // is identical either way, so merging duplicates cannot change the verdict.
  const reconciliation = reconcile(input.totalValue, holdings);
  if (!reconciliation.withinTolerance && !input.acknowledgeMismatch) {
    throw new ReconciliationError(
      `Holdings do not reconcile: positions sum to ${reconciliation.holdingsSum.toFixed(2)} ` +
      `but the account total is ${input.totalValue.toFixed(2)} ` +
      `(delta ${reconciliation.delta.toFixed(2)}). Acknowledge to commit anyway.`,
    );
  }

  const now = new Date().toISOString();

  // Every async step happens here, before anything is deleted.
  const resolved: ResolvedHolding[] = [];
  for (const h of holdings) {
    const security = await resolveOrCreateSecurity(
      { ticker: h.ticker, name: h.name, kind: h.kind, assetType: h.assetType, tagSource: h.tagSource },
      db,
    );
    resolved.push({ securityId: security.id, quantity: h.quantity, value: h.value });
  }
  const rows = aggregateHoldings(resolved);

  const snapshotId = crypto.randomUUID();

  db.transaction(() => {
    const prior = db.select().from(schema.investmentSnapshots)
      .where(and(
        eq(schema.investmentSnapshots.accountId, input.accountId),
        eq(schema.investmentSnapshots.asOf, input.asOf),
      )).get();
    if (prior) {
      db.delete(schema.snapshotHoldings)
        .where(eq(schema.snapshotHoldings.snapshotId, prior.id)).run();
      db.delete(schema.investmentSnapshots)
        .where(eq(schema.investmentSnapshots.id, prior.id)).run();
    }

    db.insert(schema.investmentSnapshots).values({
      id: snapshotId,
      accountId: input.accountId,
      asOf: input.asOf,
      month: monthOfDate(input.asOf),
      source: input.source,
      totalValue: input.totalValue,
      // Only a reconciling, non-empty holdings list counts as complete. This is
      // what gates a mixed-purpose account's return calculation.
      holdingsComplete: holdings.length > 0 && reconciliation.withinTolerance,
      note: input.note ?? '',
      createdAt: now,
      modifiedAt: now,
    }).run();

    for (const h of rows) {
      db.insert(schema.snapshotHoldings).values({
        id: crypto.randomUUID(),
        snapshotId,
        securityId: h.securityId,
        quantity: h.quantity,
        value: h.value,
      }).run();
    }
  });

  return { snapshotId, reconciliation };
}

export async function listSnapshots(
  accountId: string | null,
  db: Db = getDb(),
): Promise<SnapshotWithHoldings[]> {
  const snaps = accountId
    ? db.select().from(schema.investmentSnapshots)
        .where(eq(schema.investmentSnapshots.accountId, accountId)).all()
    : db.select().from(schema.investmentSnapshots).all();

  if (snaps.length === 0) return [];

  const held = db.select().from(schema.snapshotHoldings)
    .where(inArray(schema.snapshotHoldings.snapshotId, snaps.map((s) => s.id))).all();

  const bySnapshot = new Map<string, SnapshotWithHoldings['holdings']>();
  for (const h of held) {
    const list = bySnapshot.get(h.snapshotId) ?? [];
    list.push({ securityId: h.securityId, quantity: h.quantity, value: h.value });
    bySnapshot.set(h.snapshotId, list);
  }

  return snaps
    .map((s) => ({
      id: s.id,
      accountId: s.accountId,
      asOf: s.asOf,
      month: s.month,
      source: s.source,
      totalValue: s.totalValue,
      holdingsComplete: s.holdingsComplete,
      holdings: bySnapshot.get(s.id) ?? [],
    }))
    .sort((a, b) => a.asOf.localeCompare(b.asOf));
}
