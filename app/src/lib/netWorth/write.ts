import { randomUUID } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { accounts, balanceSnapshots, investmentSnapshots } from '@/db/schema';
import { catalogByKey } from '@/lib/netWorth/catalog';

type Db = ReturnType<typeof getDb>;

export class AccountHasHistoryError extends Error {
  constructor(public accountId: string) {
    super('This item has recorded values. Close it instead of deleting it, so past periods stay correct.');
    this.name = 'AccountHasHistoryError';
  }
}

export class DuplicateItemNameError extends Error {
  constructor(public itemName: string) {
    super(`You already have an item called "${itemName}". Give this one a different name.`);
    this.name = 'DuplicateItemNameError';
  }
}

export interface SnapshotInput {
  accountId: string;
  asOf: string;
  balance: number;
  source?: string;
  note?: string;
  valueLow?: number | null;
  valueHigh?: number | null;
}

/**
 * Write one dated reading, correcting any existing reading for the same day.
 *
 * An 'estimate' never overwrites a 'manual' row: a number the user typed is a
 * measurement, and a model output must not silently replace it. Everything else
 * overwrites, so re-entering a value on the same day fixes a typo rather than
 * stacking rows.
 */
export async function upsertBalanceSnapshot(input: SnapshotInput, db: Db = getDb()): Promise<void> {
  const now = new Date().toISOString();
  const source = input.source ?? 'manual';
  const existing = db.select().from(balanceSnapshots)
    .where(and(eq(balanceSnapshots.accountId, input.accountId), eq(balanceSnapshots.asOf, input.asOf)))
    .get();

  if (existing) {
    if (existing.source === 'manual' && source === 'estimate') return;
    db.update(balanceSnapshots)
      .set({
        balance: input.balance, source, note: input.note ?? existing.note,
        valueLow: input.valueLow ?? null, valueHigh: input.valueHigh ?? null, modifiedAt: now,
      })
      .where(eq(balanceSnapshots.id, existing.id)).run();
    return;
  }

  db.insert(balanceSnapshots).values({
    id: randomUUID(), accountId: input.accountId, asOf: input.asOf,
    month: input.asOf.slice(0, 7), balance: input.balance, source,
    note: input.note ?? '', valueLow: input.valueLow ?? null, valueHigh: input.valueHigh ?? null,
    createdAt: now, modifiedAt: now,
  }).run();
}

export interface CreateInput {
  catalogKey: string;
  name: string;
  value?: number | null;
  asOf?: string;
  securedByAccountId?: string | null;
}

export async function createNetWorthAccount(input: CreateInput, db: Db = getDb()): Promise<string> {
  const item = catalogByKey(input.catalogKey);
  if (!item) throw new Error(`Unknown catalog key: ${input.catalogKey}`);

  // Every manual net-worth item is created with the same (owner, institution,
  // mask) = ('', 'Manual', null), so the real uniqueness constraint on
  // (owner, institution, name, coalesce(mask,'')) collapses to "name must be
  // unique among these items." AddItemSheet pre-fills the name with the catalog
  // label, and a household can easily own two of the same thing (two cars, two
  // credit cards) — checking here turns that first-run collision into a message
  // the user can act on, rather than a raw driver error surfacing as a 500.
  const dup = db.select().from(accounts)
    .where(and(eq(accounts.owner, ''), eq(accounts.institution, 'Manual'), eq(accounts.name, input.name), isNull(accounts.mask)))
    .get();
  if (dup) throw new DuplicateItemNameError(input.name);

  const now = new Date().toISOString();
  const id = randomUUID();
  db.insert(accounts).values({
    id, name: input.name, institution: 'Manual', owner: '',
    accountClass: item.accountClass, purpose: 'portfolio',
    type: item.group === 'debt' ? 'loan' : item.group,
    subtype: item.subtype, origin: 'manual', status: 'active',
    reviewIntervalMonths: item.reviewIntervalMonths,
    securedByAccountId: input.securedByAccountId ?? null,
    createdAt: now, modifiedAt: now,
  }).run();

  // No value is allowed. It lands in missing[] and the add sheet says so before
  // saving — an unvalued item is honest, a zero-valued one is a lie.
  if (input.value !== null && input.value !== undefined) {
    await upsertBalanceSnapshot({
      accountId: id, asOf: input.asOf ?? new Date().toISOString().slice(0, 10),
      balance: input.value, source: 'manual',
    }, db);
  }
  return id;
}

export async function closeNetWorthAccount(id: string, closedAtMonth: string, db: Db = getDb()): Promise<void> {
  db.update(accounts)
    .set({ status: 'closed', closedAtMonth, modifiedAt: new Date().toISOString() })
    .where(eq(accounts.id, id)).run();
}

/**
 * Hard delete, allowed only while the item has no readings.
 *
 * Once anything has been recorded, deletion would rewrite past periods on the
 * trend chart — "I sold my car" must not erase a year of net worth history.
 * That case is a close, not a delete. History can live in either snapshot
 * table: an insurance-purpose investment account (e.g. an IUL policy) is
 * valued through investment_snapshots, never balance_snapshots, so both must
 * be checked or that history slips through unguarded.
 */
export class InvestmentHistoryError extends Error {
  constructor(public accountId: string) {
    super(
      'This item has investment history, which the Investments page reads for its ' +
      'charts and returns. Close it here, or remove it from Investments first.',
    );
    this.name = 'InvestmentHistoryError';
  }
}

/**
 * Delete an item.
 *
 * By default this refuses once anything has been recorded — deleting an item
 * with history rewrites past periods on the trend chart, and "I sold my car"
 * must never erase a year of net worth. `withHistory` is the user's explicit,
 * confirmed consent to exactly that, taken via a checkbox in the close dialog,
 * so the guard is bypassed rather than removed: it protects against the
 * accident, not against the deliberate choice.
 *
 * Investment history is never removable from here regardless of the flag. Those
 * snapshots feed the Investments page's charts, ROI and allocation — deleting
 * them from the net worth register would damage a different feature the user is
 * not looking at and did not agree to change.
 */
export async function deleteNetWorthAccount(
  id: string,
  db: Db = getDb(),
  opts: { withHistory?: boolean } = {},
): Promise<void> {
  const investments = db.select().from(investmentSnapshots)
    .where(eq(investmentSnapshots.accountId, id)).all();
  if (investments.length > 0) {
    throw opts.withHistory ? new InvestmentHistoryError(id) : new AccountHasHistoryError(id);
  }

  const balances = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).all();
  if (balances.length > 0) {
    if (!opts.withHistory) throw new AccountHasHistoryError(id);
    db.delete(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).run();
  }

  db.delete(accounts).where(eq(accounts.id, id)).run();
}
