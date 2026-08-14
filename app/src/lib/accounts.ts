import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { accountMatchKey, canonicalAccount } from '@/lib/accountName';

type Db = ReturnType<typeof getDb>;
export type AccountRow = typeof schema.accounts.$inferSelect;

export interface ResolveAccountInput {
  institution: string;
  name: string;
  owner?: string;
  mask?: string | null;
  accountClass?: 'spending' | 'investment' | 'liability';
  type?: string;
  subtype?: string | null;
  origin?: 'plaid' | 'manual';
  plaidAccountId?: string | null;
  plaidItemId?: string | null;
}

/**
 * Thrown when a manual "create account" request would collide with an account
 * that already exists for that owner. Distinct type so the route maps it to a
 * 409 with a clear message instead of silently adopting the existing row the
 * way resolveOrCreateAccount does — adoption is correct for ingestion, wrong
 * for a create button.
 */
export class AccountExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountExistsError';
  }
}

export interface ManualAccountInput {
  institution: string;
  name: string;
  owner?: string;
  purpose?: 'portfolio' | 'reserve' | 'insurance' | 'education';
}

/**
 * Hand-create an investment account for something Plaid cannot reach. Unlike
 * resolveOrCreateAccount, a canonical-key collision is an ERROR, not an adopt.
 */
export async function createManualAccount(
  input: ManualAccountInput,
  db: Db = getDb(),
): Promise<AccountRow> {
  const canon = canonicalAccount(input.institution.trim() || 'Unknown', input.name.trim() || 'Account', { type: 'investment' });
  const institution = canon.institution;
  const name = canon.name;
  const owner = input.owner ?? '';
  const purpose = input.purpose ?? 'portfolio';

  const wantKey = accountMatchKey(institution, name);
  const collision = db.select().from(schema.accounts).all().find(
    (a) => a.owner === owner && a.mask === null && accountMatchKey(a.institution, a.name) === wantKey,
  );
  if (collision) {
    throw new AccountExistsError(
      `An account "${institution} / ${name}" already exists for ${owner || 'no owner'}.`,
    );
  }

  const now = new Date().toISOString();
  const row: AccountRow = {
    id: randomUUID(),
    name,
    institution,
    owner,
    // The user typed this name, so it is user intent and must survive later
    // canonicalization passes — same reason applyAccountPatch stamps 'user' on rename.
    nameSource: 'user',
    mask: null,
    accountClass: 'investment',
    purpose,
    type: 'unknown',
    subtype: null,
    origin: 'manual',
    plaidItemId: null,
    plaidAccountId: null,
    closedAtMonth: null,
    status: 'active',
    createdAt: now,
    modifiedAt: now,
  };
  db.insert(schema.accounts).values(row).run();
  return row;
}

export async function resolveOrCreateAccount(input: ResolveAccountInput, db: Db = getDb()): Promise<AccountRow> {
  let institution = input.institution.trim() || 'Unknown';
  let name = input.name.trim() || 'Account';

  if (input.plaidAccountId) {
    // A Plaid account's identity is its plaidAccountId, never (institution, name).
    const byPlaid = db.select().from(schema.accounts)
      .where(eq(schema.accounts.plaidAccountId, input.plaidAccountId)).get();
    if (byPlaid) return byPlaid;
    // No plaidAccountId match → this is a NEW, distinct bank account. Do NOT reuse an
    // existing (institution, name) row: two different Plaid accounts can share a name,
    // and attaching one to the other's row would silently drop its transactions.
    // Disambiguate the display name only as needed to satisfy the unique
    // (institution, name) index.
    name = uniqueAccountName(institution, name, input, db);
  } else {
    // PDF / manual path: match on the canonical (institution, label) key, so
    // name/institution variants (e.g. "JPMorgan Chase Bank, N.A." / "Credit Card -
    // Freedom Unlimited" vs "Chase" / "Credit Card (Freedom Unlimited)") collapse
    // onto one row — then disambiguate by mask. Two people can hold the same
    // product at the same bank, so the canonical key alone is NOT an identity;
    // the mask is. Without this, one person's statement lands on the other's
    // account and the two card histories silently fuse.
    const wantKey = accountMatchKey(institution, name, { type: input.type, subtype: input.subtype ?? undefined });
    const candidates = db.select().from(schema.accounts).all()
      .filter((a) => accountMatchKey(a.institution, a.name) === wantKey);

    if (input.mask) {
      const exact = candidates.find((a) => a.mask === input.mask);
      if (exact) return exact;
      // A single mask-less candidate is the same card seen before the mask was
      // known (pre-backfill imports) — adopt it and record the mask.
      const unmasked = candidates.filter((a) => !a.mask);
      if (unmasked.length === 1) {
        db.update(schema.accounts)
          .set({ mask: input.mask, modifiedAt: new Date().toISOString() })
          .where(eq(schema.accounts.id, unmasked[0].id)).run();
        return { ...unmasked[0], mask: input.mask };
      }
      // Otherwise fall through and create a new account for this mask.
    } else {
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) {
        throw new Error(
          `Ambiguous account match for "${institution} / ${name}": ${candidates.length} accounts share ` +
          `this product and the import supplies no mask to tell them apart ` +
          `(${candidates.map((c) => `${c.owner || '?'}:${c.mask ?? 'no-mask'}`).join(', ')}). ` +
          `Re-import with a filename containing the card's last 4, or merge the duplicates.`,
        );
      }
    }

    // No match → brand-new PDF/manual account. Store it under its canonical
    // (institution, name) so it's born clean and future imports match by key.
    const canon = canonicalAccount(institution, name, { type: input.type, subtype: input.subtype ?? undefined });
    institution = canon.institution;
    name = canon.name;
  }

  const now = new Date().toISOString();
  const row: AccountRow = {
    id: randomUUID(),
    name,
    institution,
    owner: input.owner ?? '',
    nameSource: 'derived',
    mask: input.mask ?? null,
    accountClass: input.accountClass ?? 'spending',
    purpose: 'portfolio',
    type: input.type ?? 'unknown',
    subtype: input.subtype ?? null,
    origin: input.origin ?? 'manual',
    plaidItemId: input.plaidItemId ?? null,
    plaidAccountId: input.plaidAccountId ?? null,
    closedAtMonth: null,
    status: 'active',
    createdAt: now,
    modifiedAt: now,
  };
  db.insert(schema.accounts).values(row).run();
  return row;
}

// Return a name that is unique under the (owner, institution, name, mask) index.
// Only used when creating a brand-new Plaid account whose base name collides with
// an existing (different) account. Because the mask is part of the key, two cards
// of the same product now coexist under the SAME name — the display layer adds the
// "· 3110" suffix. A suffix is therefore only needed when the mask is absent too.
// Disambiguates deterministically using the plaidAccountId so the same account
// always resolves the same way.
function uniqueAccountName(institution: string, base: string, input: ResolveAccountInput, db: Db): string {
  const owner = input.owner ?? '';
  const mask = input.mask ?? null;
  const taken = (n: string) => Boolean(
    db.select().from(schema.accounts).all()
      .find((a) => a.owner === owner && a.institution === institution && a.name === n && a.mask === mask),
  );
  if (!taken(base)) return base;
  const suffix = input.mask ?? (input.plaidAccountId ? input.plaidAccountId.slice(-4) : 'acct');
  let candidate = `${base} (${suffix})`;
  let n = 2;
  while (taken(candidate)) candidate = `${base} (${suffix}-${n++})`;
  return candidate;
}

export async function getAccount(id: string, db: Db = getDb()): Promise<AccountRow | null> {
  return db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get() ?? null;
}

export async function listAccounts(db: Db = getDb()): Promise<AccountRow[]> {
  return db.select().from(schema.accounts).all();
}

export async function getAccountByPlaidId(plaidAccountId: string, db: Db = getDb()): Promise<AccountRow | null> {
  return db.select().from(schema.accounts).where(eq(schema.accounts.plaidAccountId, plaidAccountId)).get() ?? null;
}
