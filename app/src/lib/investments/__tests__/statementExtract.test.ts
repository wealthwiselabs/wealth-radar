import { describe, it, expect } from 'vitest';
import { EXTRACT_SYSTEM } from '@/lib/investments/statementExtract';

describe('EXTRACT_SYSTEM', () => {
  it('is the shared multi-account extraction prompt', () => {
    expect(typeof EXTRACT_SYSTEM).toBe('string');
    expect(EXTRACT_SYSTEM).toMatch(/MULTIPLE accounts/);
    expect(EXTRACT_SYSTEM).toMatch(/Contribution Summary/);
    expect(EXTRACT_SYSTEM).toMatch(/reportedTotal/);
  });
});
