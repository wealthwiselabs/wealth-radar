import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { mergeAccounts } from '@/lib/accountMerge';

type Db = ReturnType<typeof getDb>;
type AccountRow = typeof schema.accounts.$inferSelect;

export interface AutoMerge {
  targetId: string;
  sourceId: string;
  display: string;
}

/**
 * Fold a newly-linked Plaid account into the PDF/manual account whose history it
 * continues, so a bank connection doesn't leave the same real-world account
 * split across two rows (one holding statement history, one holding the feed).
 *
 * Run at LINK time, before the first sync, while the Plaid rows still have no
 * transactions — merging then only re-points identity, never data.
 *
 * The rules are deliberately conservative: a wrong merge silently fuses two
 * real accounts (potentially two different people's), which is far worse than
 * leaving a duplicate for the user to merge by hand. All of these must hold:
 *
 *  - the candidate is a PDF/manual row (no plaidAccountId) — two live Plaid
 *    accounts are never merged;
 *  - same owner, and neither side is unassigned (an unassigned row has no
 *    established claim, so matching it would be a guess);
 *  - same institution, and either the same canonical label or the same non-null
 *    mask on both sides. The false-positive case is one person holding two
 *    distinct cards at one institution that share a last four. The histories
 *    check below only partly covers it: it rejects the pair when both were
 *    active in the same period, but two such cards used sequentially — one
 *    retired before the other opened — share no calendar day and would still
 *    merge. Nothing here catches that; it is accepted as vanishingly rare;
 *  - masks are compatible: the candidate has none, or they are identical.
 *    Different masks mean different cards, full stop;
 *  - exactly one candidate, and no other new Plaid account claims that same
 *    candidate — any ambiguity is left to the user;
 *  - the two rows' transactions are compatible: either the Plaid row is still
 *    empty (the normal link-time case), or the histories share no transaction
 *    and no calendar day. Overlapping activity means two live accounts, not one
 *    account's statement history followed by its feed.
 */
export function autoMergePlaidIntoHistory(plaidItemId: string, db: Db = getDb()): AutoMerge[] {
  const all = db.select().from(schema.accounts).all();
  const incoming = all.filter((a) => a.plaidItemId === plaidItemId && a.plaidAccountId);

  const txOf = (id: string) =>
    db.select().from(schema.transactions).where(eq(schema.transactions.accountId, id)).all();

  /**
   * True when the two rows can only be one account's history followed by its
   * feed: the Plaid side is empty, or the two never transacted on the same day.
   * A shared day is the earliest sign of two accounts running in parallel.
   */
  const historiesAreContinuous = (plaidId: string, candidateId: string): boolean => {
    const feed = txOf(plaidId);
    if (feed.length === 0) return true;
    const history = txOf(candidateId);
    if (history.length === 0) return true;
    const days = new Set(history.map((t) => t.date));
    return !feed.some((t) => days.has(t.date));
  };

  const candidatesFor = (p: AccountRow): AccountRow[] =>
    all.filter((c) =>
      !c.plaidAccountId &&                       // never another live Plaid account
      c.id !== p.id &&
      c.owner !== '' && p.owner !== '' &&        // both sides must be attributed
      c.owner === p.owner &&
      c.institution === p.institution &&
      // Identity comes from the canonical label OR from the card itself. Plaid
      // and a PDF often name the same card differently ("Southwest Rapid
      // Rewards" vs "Southwest"), and when both sides carry the same real last
      // four that is the stronger signal of the two.
      (c.name === p.name || (c.mask != null && p.mask != null && c.mask === p.mask)) &&
      (c.mask == null || c.mask === p.mask));    // different masks = different cards

  // Pair up first, then reject any candidate wanted by more than one incoming
  // account — otherwise the first one processed would win arbitrarily.
  const pairs: Array<{ plaid: AccountRow; candidate: AccountRow }> = [];
  for (const p of incoming) {
    const candidates = candidatesFor(p);
    if (candidates.length !== 1) continue;
    if (!historiesAreContinuous(p.id, candidates[0].id)) continue;
    pairs.push({ plaid: p, candidate: candidates[0] });
  }

  const claimCount = new Map<string, number>();
  for (const { candidate } of pairs) claimCount.set(candidate.id, (claimCount.get(candidate.id) ?? 0) + 1);

  const done: AutoMerge[] = [];
  for (const { plaid, candidate } of pairs) {
    if ((claimCount.get(candidate.id) ?? 0) !== 1) continue;
    // Target is the PDF row: it holds the history, and mergeAccounts moves the
    // Plaid identity (id, item, mask, type) onto whichever row survives.
    mergeAccounts(candidate.id, [plaid.id], db);
    done.push({
      targetId: candidate.id,
      sourceId: plaid.id,
      display: `${candidate.owner} ${candidate.institution} ${candidate.name}`.trim(),
    });
  }
  return done;
}
