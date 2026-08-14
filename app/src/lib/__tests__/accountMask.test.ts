import { describe, it, expect } from 'vitest';
import { maskFromSourceFile, verifyMaskInText } from '@/lib/accountMask';

describe('maskFromSourceFile', () => {
  it('extracts the mask from a Chase statement filename', () => {
    expect(maskFromSourceFile('20260121-statements-3124-.pdf')).toBe('3124');
    expect(maskFromSourceFile('20260311-statements-3126-sam.pdf')).toBe('3126');
    expect(maskFromSourceFile('20260320-statements-3103-southwest-sam.pdf')).toBe('3103');
  });

  it('returns null for filenames with no Chase statement pattern', () => {
    expect(maskFromSourceFile('2026-01-21.pdf')).toBeNull();
    expect(maskFromSourceFile('January 26-citi.pdf')).toBeNull();
    expect(maskFromSourceFile('2026-03-20-sam-amex-green.pdf')).toBeNull();
    expect(maskFromSourceFile(null)).toBeNull();
    expect(maskFromSourceFile(undefined)).toBeNull();
  });

  it('does not mistake the leading date for a mask', () => {
    expect(maskFromSourceFile('20260106-statements-3128-.pdf')).toBe('3128');
  });
});

describe('verifyMaskInText', () => {
  it('accepts digits printed after a worded cue', () => {
    expect(verifyMaskInText('3107', 'Account ending in 3107')).toBe('3107');
    expect(verifyMaskInText('3107', 'Card Ending 3107')).toBe('3107');
    expect(verifyMaskInText('3124', 'ACCOUNT NUMBER: 3124')).toBe('3124');
    expect(verifyMaskInText('3124', 'Account #3124')).toBe('3124');
  });

  it('accepts digits printed after a redaction run', () => {
    expect(verifyMaskInText('3107', 'Card  •••• 3107')).toBe('3107');
    expect(verifyMaskInText('3107', 'Card ****3107')).toBe('3107');
    // Amex prints the last five; the last four still identify the card.
    expect(verifyMaskInText('3107', 'XXXX-XXXXXX-53107')).toBe('3107');
  });

  it('rejects digits that do not appear in the text at all', () => {
    expect(verifyMaskInText('3114', 'Account ending in 3107')).toBeNull();
  });

  it('rejects digits that appear with no cue near them', () => {
    // A transaction amount, not an account number.
    expect(verifyMaskInText('3107', 'GROCERY OUTLET  10.08  balance 3107')).toBeNull();
    // A cue exists but is too far away to vouch for these digits.
    const far = `Account ending in 3114${' '.repeat(60)}3107`;
    expect(verifyMaskInText('3107', far)).toBeNull();
  });

  it('rejects anything that is not exactly four digits', () => {
    expect(verifyMaskInText('108', 'Account ending in 108')).toBeNull();
    expect(verifyMaskInText('10080', 'Account ending in 10080')).toBeNull();
    expect(verifyMaskInText('10a8', 'Account ending in 10a8')).toBeNull();
    expect(verifyMaskInText(null, 'Account ending in 3107')).toBeNull();
    expect(verifyMaskInText(undefined, 'Account ending in 3107')).toBeNull();
  });

  it('finds a later occurrence when the first one has no cue', () => {
    expect(verifyMaskInText('3107', 'total 3107 ... Account ending in 3107')).toBe('3107');
  });

  it('rejects a redaction run that is not adjacent to the digits', () => {
    // 'xxx' is 20 characters away from the digits and has nothing to do with a card.
    expect(verifyMaskInText('3107', 'xxx invoice number 3107')).toBeNull();
  });

  it('accepts a redaction run that ends close to the digits', () => {
    expect(verifyMaskInText('3107', 'Card  •••• 3107')).toBe('3107');
    // Amex prints the last five; the run ends 2 chars before the digits ('-5').
    expect(verifyMaskInText('3107', 'XXXX-XXXXXX-53107')).toBe('3107');
  });

  it('does not throw and returns null when text is not a string', () => {
    expect(verifyMaskInText('3107', null as unknown as string)).toBeNull();
    expect(verifyMaskInText('3107', undefined as unknown as string)).toBeNull();
  });

  it('rejects a bare "ending" cue matching "Ending Balance" or "Pending"', () => {
    // "ending" is a substring of "Ending Balance", printed on virtually every statement.
    expect(verifyMaskInText('3110', 'Ending Balance 3110.56')).toBeNull();
    // "ending" is also a substring of "Pending".
    expect(verifyMaskInText('3107', 'Payments Pending 3107.42')).toBeNull();
  });

  it('still accepts genuine account-ending / card-ending / account-number cues', () => {
    expect(verifyMaskInText('3107', 'Account ending in 3107')).toBe('3107');
    expect(verifyMaskInText('3107', 'Card Ending 3107')).toBe('3107');
    expect(verifyMaskInText('3124', 'ACCOUNT NUMBER: 3124')).toBe('3124');
  });

  it('rejects when the statement contains two distinct cue-verified numbers', () => {
    const text = 'Checking account ending in 3114. Electronic payment from account ending in 3124.';
    expect(verifyMaskInText('3124', text)).toBeNull();
    expect(verifyMaskInText('3114', text)).toBeNull();
  });

  it('still accepts when the same cue-verified number repeats (one distinct value)', () => {
    const text = 'Account ending in 3107. Thank you for your payment. Card ending 3107 statement.';
    expect(verifyMaskInText('3107', text)).toBe('3107');
  });
});
