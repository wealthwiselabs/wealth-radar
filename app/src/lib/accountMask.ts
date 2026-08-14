/**
 * Chase statement downloads are named `YYYYMMDD-statements-<mask>-<suffix>.pdf`.
 * That mask is the only evidence linking a PDF-derived account to the specific
 * card it came from, which is what keeps two people's same-product cards apart.
 *
 * Other institutions (Amex, Citi, US Bank) use ad-hoc filenames with no
 * reliable mask, so they return null and those accounts stay mask-less.
 */
export function maskFromSourceFile(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const m = /-statements-(\d{4})-/.exec(fileName);
  return m ? m[1] : null;
}

/**
 * How far before the digits an account-number cue may sit and still vouch for
 * them. Wide enough to span "Account Number: XXXX-XXXXXX-51008" and the
 * label/value gap in a two-column statement header; narrow enough that a cue
 * elsewhere on the line cannot vouch for an unrelated number.
 */
const CUE_WINDOW = 40;

/**
 * Lower-cased, because the haystack is lower-cased before searching.
 *
 * Deliberately NOT the bare 'ending' — it is a substring of 'Ending Balance'
 * (printed on essentially every statement) and of 'Pending', so it would vouch
 * for arbitrary balance/transaction digits. 'ending in' and 'card ending' stay
 * as their own entries since they are no longer redundant with the bare form.
 */
const CUES = ['ending in', 'account ending', 'account number', 'account #', 'card ending'];

/** Three or more redaction characters, optionally spaced or hyphenated. */
const REDACTION_RUN = /[•*x][\s-]*[•*x][\s-]*[•*x]/;

/**
 * How close the end of a redaction run must be to the digits to vouch for
 * them. Unlike worded cues, a run of bullets/asterisks/x's is common enough in
 * unrelated formatting that it must actually abut the digits, not just appear
 * somewhere in the look-back window.
 *
 * 4 is the smallest value that covers both real formats. The regex matches only
 * the first three run characters, so the measured gap is wider than it looks:
 *   'Card  •••• 3107'   → matches '•••', leaving '• ' → gap 2
 *   'XXXX-XXXXXX-51008' → indexOf lands inside '51008', so the look-back ends
 *                         '…xxxx-xxxxxx-5'; the last match leaves '-5' → gap 3
 * Do not shrink this below 4 on the assumption that a run always abuts the
 * digits — Amex needs the slack.
 */
const REDACTION_PROXIMITY = 4;

/** Does a cue (worded, or an abutting redaction run) vouch for the 4 digits starting at `start`? */
function isCueVerified(hay: string, start: number): boolean {
  const before = hay.slice(Math.max(0, start - CUE_WINDOW), start);
  if (CUES.some((c) => before.includes(c))) return true;

  const runRegex = new RegExp(REDACTION_RUN.source, 'g');
  for (let m = runRegex.exec(before); m; m = runRegex.exec(before)) {
    const distanceFromEnd = before.length - (m.index + m[0].length);
    if (distanceFromEnd <= REDACTION_PROXIMITY) return true;
  }
  return false;
}

/**
 * Accept a model-supplied mask only if the statement unambiguously prints it as
 * an account number. The model reads the whole statement, so it can surface the
 * right digits — but a misread would silently fuse two unrelated accounts when
 * auto-merge later matches on mask. Requiring the digits to appear next to a
 * cue means the model can only surface what is genuinely on the page — but
 * being printed on the page is not the same as being *this account's* number:
 * a statement routinely prints more than one cue-verified account number (e.g.
 * a card statement's payment section naming the checking account it was paid
 * from). We cannot tell which printed number belongs to the account being
 * classified, so when more than one distinct candidate is cue-verified, the
 * statement does not unambiguously identify one account and the result is
 * rejected rather than guessed.
 */
export function verifyMaskInText(mask: string | null | undefined, text: string): string | null {
  if (!mask || !/^\d{4}$/.test(mask)) return null;
  if (typeof text !== 'string') return null;
  const hay = text.toLowerCase();

  // Collect every distinct 4-digit candidate that a cue vouches for. A candidate
  // is the last 4 digits of each maximal run of digits (matching how a "mask" is
  // conventionally the last 4 of a longer printed number, e.g. Amex's 5-digit
  // trailing group) — not every sliding 4-digit window, which would spuriously
  // treat overlapping windows of the same printed number as separate accounts.
  const verified = new Set<string>();
  const runRegex = /\d+/g;
  for (let r = runRegex.exec(hay); r; r = runRegex.exec(hay)) {
    const run = r[0];
    if (run.length < 4) continue;
    const candidateStart = r.index + run.length - 4;
    const candidate = run.slice(-4);
    if (isCueVerified(hay, candidateStart)) verified.add(candidate);
  }

  if (verified.size !== 1) return null;
  const [onlyCandidate] = verified;
  return onlyCandidate === mask ? mask : null;
}
