import { describe, it, expect } from 'vitest';
import { isStatementFile } from '@/lib/investments/statementFiles';

describe('isStatementFile', () => {
  it('excludes 529 statements named "529s"', () => {
    expect(isStatementFile('2025-03 VG Statement 529s.pdf')).toBe(false);
    expect(isStatementFile('2025-12 VG Statement 529s.pdf')).toBe(false);
  });
  it('excludes a bare "529" token too', () => {
    expect(isStatementFile('2025-03 VG Statement 529.pdf')).toBe(false);
  });
  it('excludes the annual report', () => {
    expect(isStatementFile('Fid-Annual-report-Statement12312025.pdf')).toBe(false);
  });
  it('excludes non-pdf files', () => {
    expect(isStatementFile('roblox-401k-history.csv')).toBe(false);
  });
  it('includes normal monthly statements', () => {
    expect(isStatementFile('2026-01 VG Statement x5693.pdf')).toBe(true);
    expect(isStatementFile('Fid-Statement01312025.pdf')).toBe(true);
    expect(isStatementFile('Fidelity-Acme-401k-2025Q1.pdf')).toBe(true);
  });
  it('does not false-positive on a "0529"-style date fragment', () => {
    expect(isStatementFile('Fid-Statement05292025.pdf')).toBe(true);
  });
});
