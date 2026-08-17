/**
 * Keyword search over the transactions the table already shows.
 *
 * Runs entirely client-side, on top of whatever the time-range and
 * category/month filters have already narrowed to — the caller passes in the
 * pre-filtered rows, so search never widens the set back out.
 *
 * "Blur" matching: a query token matches a field either as a substring or,
 * for longer tokens, within a small Levenshtein edit distance of a word in the
 * text, so typos ("amazn") and near-misses ("starbcks") still hit.
 */

/** The row fields searched directly. Category/subcategory names come via `labels`. */
export interface SearchableRow {
  description: string;
  note: string;
  bank: string;
  account: string;
  owner: string;
}

interface SearchLabels<T> {
  category: (t: T) => string;
  subcategory: (t: T) => string;
}

/**
 * Fuzzy tolerance scales with token length. Short tokens are matched by
 * substring only: at 4 chars or fewer, a single edit turns one real word into
 * another ("amex" → "alex"), so fuzzing them conflates distinct merchants and
 * owners. From 5 chars up a single typo is safe to absorb, and long tokens can
 * take two.
 */
function fuzzThreshold(len: number): number {
  if (len <= 4) return 0;
  if (len <= 7) return 1;
  return 2;
}

/**
 * Levenshtein distance, bailing out as soon as the whole row exceeds `max`.
 * The early exit keeps this cheap for the common case of clearly-different
 * words (which is most word/token pairs on any given row).
 */
function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    // If every cell in this row already exceeds the budget, so will the rest.
    if (rowMin > max) return false;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] <= max;
}

/** Split a field into lowercase alphanumeric words for fuzzy comparison. */
function toWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
}

/** True when `token` matches somewhere in `haystack` (substring or fuzzy). */
function tokenMatches(token: string, haystack: string, words: string[]): boolean {
  if (haystack.includes(token)) return true;
  const threshold = fuzzThreshold(token.length);
  if (threshold === 0) return false;
  return words.some((w) => editDistanceWithin(token, w, threshold));
}

/**
 * Filter `rows` to those matching `query`, preserving input order.
 *
 * Multi-word queries are AND-ed: every token must match some field, so
 * "amazon gift" narrows rather than widens. An empty/whitespace query is a
 * no-op that returns the rows unchanged.
 */
export function searchTransactions<T extends SearchableRow>(
  rows: readonly T[],
  query: string,
  labels: SearchLabels<T>,
): T[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...rows];

  return rows.filter((row) => {
    const haystack = [
      row.description,
      row.note,
      row.bank,
      row.account,
      row.owner,
      labels.category(row),
      labels.subcategory(row),
    ]
      .join(' ')
      .toLowerCase();
    const words = toWords(haystack);
    return tokens.every((token) => tokenMatches(token, haystack, words));
  });
}
