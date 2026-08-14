import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { makeTmpDb } from '@/test/tmpDb';
import { importFromDisk } from '../../../scripts/migrate-csv';
import { readTransactions } from '@/lib/storage';

const CSV = `id,date,description,amount,bank,account,categoryId,subcategoryId,note,source,createdAt,modifiedAt
x1,2026-01-15,STARBUCKS,-4.5,Chase,Credit Card,food,coffee,,jan.pdf,2026-01-16T00:00:00.000Z,2026-01-16T00:00:00.000Z
x2,2026-01-20,PAYCHECK,1000,Chase,Checking,income,salary,,jan.pdf,2026-01-21T00:00:00.000Z,2026-01-21T00:00:00.000Z`;

describe('importFromDisk', () => {
  it('imports transactions and is idempotent', async () => {
    const { db } = makeTmpDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etcsv-'));
    fs.writeFileSync(path.join(dir, 'transactions.csv'), CSV);

    const first = await importFromDisk({ dataDir: dir, db });
    expect(first.transactions).toBe(2);
    expect(await readTransactions(db)).toHaveLength(2);

    const second = await importFromDisk({ dataDir: dir, db });
    expect(second.transactions).toBe(0);          // idempotent
    expect(await readTransactions(db)).toHaveLength(2);
  });

  it('keeps per-file source when one (bank, account) spans multiple statement files', async () => {
    // Regression guard for the grouping fix: grouping by (bank, account) only
    // would collapse a folder of monthly PDFs for one account into a single
    // sourceFile. Group by (bank, account, source) instead.
    const { db } = makeTmpDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etcsv-multi-'));
    const csv = `id,date,description,amount,bank,account,categoryId,subcategoryId,note,source,createdAt,modifiedAt
y1,2026-01-10,JAN COFFEE,-4.5,Chase,Credit Card,food,coffee,,jan.pdf,2026-01-11T00:00:00.000Z,2026-01-11T00:00:00.000Z
y2,2026-02-10,FEB COFFEE,-5.5,Chase,Credit Card,food,coffee,,feb.pdf,2026-02-11T00:00:00.000Z,2026-02-11T00:00:00.000Z`;
    fs.writeFileSync(path.join(dir, 'transactions.csv'), csv);

    const result = await importFromDisk({ dataDir: dir, db });
    expect(result.transactions).toBe(2);

    const all = await readTransactions(db);
    expect(all).toHaveLength(2);
    const byDesc = Object.fromEntries(all.map((t) => [t.description, t.source]));
    expect(byDesc['JAN COFFEE']).toBe('jan.pdf');
    expect(byDesc['FEB COFFEE']).toBe('feb.pdf');
  });
});
