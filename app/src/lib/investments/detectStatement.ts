/**
 * Decide whether a PDF's extracted text is an INVESTMENT statement (holdings,
 * portfolio value, contributions) or a BANK/CARD statement (a ledger with a
 * running balance, card-payment lines). Pure — no db/anthropic imports — so the
 * browser upload path can import it and route each file before any network call.
 *
 * Binary by design: investment imports are gated behind a preview→confirm step,
 * so a rare mis-route is non-destructive (the user cancels a wrong preview).
 * When no investment signal is present we return 'bank', the safe default that
 * feeds the review-before-commit classify flow.
 */
const INVESTMENT_SIGNALS: RegExp[] = [
  /investment report/i,
  /portfolio value/i,
  /\b(beginning|ending)\b[^\n]{0,40}\bvalue\b/i,
  /\bholdings\b/i,
  /contribution summary/i,
  /\bvested\b/i,
  /401\s*\(?k\)?/i,
  /number of shares/i,
  /market value/i,
  /retirement savings/i,
];

const BANK_SIGNALS: RegExp[] = [
  /\b(beginning|ending)\s+balance\b/i,
  /automatic payment/i,
  /minimum payment due/i,
  /available credit/i,
  /deposits and additions/i,
  /withdrawals and debits/i,
  /\batm\b/i,
];

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((n, re) => (re.test(text) ? n + 1 : n), 0);
}

export function classifyStatementType(pdfText: string): 'investment' | 'bank' {
  const invest = countMatches(pdfText, INVESTMENT_SIGNALS);
  const bank = countMatches(pdfText, BANK_SIGNALS);
  // Require at least one investment cue AND that investment cues are not
  // outnumbered by bank cues. Ties go to investment (a 401k statement can carry
  // a "balance" word), but zero investment cues is always bank.
  return invest > 0 && invest >= bank ? 'investment' : 'bank';
}
