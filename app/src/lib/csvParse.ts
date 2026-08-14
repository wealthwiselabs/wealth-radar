import type { Transaction } from '@/types';

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) { fields.push(current); current = ''; }
    else { current += char; }
  }
  fields.push(current);
  return fields;
}

export function parseTransactionsCsv(content: string): Transaction[] {
  const lines = content.trim().split('\n');
  if (lines.length <= 1) return [];
  return lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    return {
      id: f[0] || '', date: f[1] || '', description: f[2] || '', amount: parseFloat(f[3]) || 0,
      // The legacy CSV export predates account ownership, so rows import as
      // unassigned; the owner is set on the account, not per transaction.
      owner: '', accountType: '',
      bank: f[4] || '', account: f[5] || '', categoryId: f[6] || '', subcategoryId: f[7] || '',
      note: f[8] || '', source: f[9] || '', createdAt: f[10] || '', modifiedAt: f[11] || '',
      accountId: f[12] || '', accountClass: (f[13] as Transaction['accountClass']) || 'spending',
    };
  });
}
