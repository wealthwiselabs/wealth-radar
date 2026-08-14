import { describe, it, expect } from 'vitest';
import { transactionFingerprint } from '@/lib/fingerprint';

describe('transactionFingerprint', () => {
  const base = { accountId: 'a1', date: '2026-01-15', description: 'STARBUCKS #123', amount: -4.5 };

  it('is stable for identical input', () => {
    expect(transactionFingerprint(base)).toBe(transactionFingerprint({ ...base }));
  });

  it('differs when amount differs', () => {
    expect(transactionFingerprint(base)).not.toBe(transactionFingerprint({ ...base, amount: -5 }));
  });

  it('differs across accounts', () => {
    expect(transactionFingerprint(base)).not.toBe(transactionFingerprint({ ...base, accountId: 'a2' }));
  });
});
