import { describe, it, expect } from 'vitest';
import { formatImportSummary, type ChatImportSummary } from '@/lib/agentPdfImport';

const base: ChatImportSummary = {
  importedCount: 0,
  skippedCount: 0,
  bankFiles: [],
  investmentFiles: [],
  errors: [],
};

describe('formatImportSummary', () => {
  it('summarizes a single-file import', () => {
    const msg = formatImportSummary({
      ...base,
      importedCount: 42,
      bankFiles: ['statement.pdf'],
    });
    expect(msg).toContain('Imported **42** transactions from **statement.pdf**.');
    expect(msg).not.toContain('duplicate');
  });

  it('uses singular wording for one transaction and reports skipped duplicates', () => {
    const msg = formatImportSummary({
      ...base,
      importedCount: 1,
      skippedCount: 3,
      bankFiles: ['a.pdf'],
    });
    expect(msg).toContain('Imported **1** transaction from');
    expect(msg).toContain('3 duplicates skipped.');
  });

  it('collapses multiple statements into a count', () => {
    const msg = formatImportSummary({
      ...base,
      importedCount: 80,
      bankFiles: ['a.pdf', 'b.pdf'],
    });
    expect(msg).toContain('from 2 statements.');
  });

  it('routes investment statements to a note instead of importing', () => {
    const msg = formatImportSummary({ ...base, investmentFiles: ['brokerage.pdf'] });
    expect(msg).toContain('1 investment statement (brokerage.pdf)');
    expect(msg).toContain('Import panel');
  });

  it('reports per-file errors with a warning marker', () => {
    const msg = formatImportSummary({
      ...base,
      errors: [{ file: 'bad.pdf', message: 'could not extract text' }],
    });
    expect(msg).toContain("⚠️ Couldn't read bad.pdf: could not extract text");
  });

  it('says nothing was found when there is no signal at all', () => {
    expect(formatImportSummary(base)).toBe('No transactions found in the selected PDF(s).');
  });
});
