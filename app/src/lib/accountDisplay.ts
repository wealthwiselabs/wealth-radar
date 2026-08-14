/**
 * Display names are DERIVED, never stored. Storing them would let the rendered
 * string drift from (owner, institution, name, mask), which is the tuple that
 * actually identifies an account.
 */
export interface DisplayAccount {
  owner: string;
  institution: string;
  name: string;
  mask?: string | null;
}

/** "{owner} {institution} {label}", skipping any empty part. */
export function accountBaseName(a: DisplayAccount): string {
  return [a.owner, a.institution, a.name]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Base name, plus a "· 3110" mask suffix when another account in `all` renders
 * the same base string. Compared by value (not identity) so callers may pass
 * plain objects rather than the same references.
 */
export function accountDisplayName(a: DisplayAccount, all?: readonly DisplayAccount[]): string {
  const base = accountBaseName(a);
  if (!all) return base;
  const collisions = all.filter((o) => accountBaseName(o) === base).length;
  return collisions > 1 && a.mask ? `${base} · ${a.mask}` : base;
}

/**
 * Transaction-row attribution: "Alex · Chase · Freedom".
 * Separated (rather than reusing accountBaseName) because a transaction carries
 * owner/bank/account as three flat strings, and the row reads better with the
 * parts visually delimited than run together as a single name.
 */
export function transactionAccountLabel(t: { owner?: string; bank: string; account: string }): string {
  return [t.owner, t.bank, t.account].map((s) => (s ?? '').trim()).filter(Boolean).join(' · ');
}
