import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { makeTmpDb } from '@/test/tmpDb';
import { importFromDisk } from '../../../scripts/migrate-csv';
import { readTransactions } from '@/lib/storage';

const CSV = `id,date,description,amount,bank,account,categoryId,subcategoryId,note,source,createdAt,modifiedAt
x1,2026-04-24,INTEREST,0.02,Citibank,Checking,income,interest-earned,note,apr.pdf,2026-04-25T00:00:00.000Z,2026-04-25T00:00:00.000Z
x2,2026-02-07,IN-N-OUT,-2.73,Chase,Credit Card,food,restaurant,,feb.pdf,2026-04-26T00:00:00.000Z,2026-04-26T00:00:00.000Z`;

describe('read path parity', () => {
  it('returns Transaction-shaped rows sorted by date desc with bank/account preserved', async () => {
    const { db } = makeTmpDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ete2e-'));
    fs.writeFileSync(path.join(dir, 'transactions.csv'), CSV);
    await importFromDisk({ dataDir: dir, db });

    const all = await readTransactions(db);
    expect(all).toHaveLength(2);
    expect(all[0].date).toBe('2026-04-24');       // newest first
    expect(all[0].bank).toBe('Citi'); // canonicalized on ingest (Task 5): "Citibank" -> "Citi"
    expect(all[1].bank).toBe('Chase');
    expect(all[1].account).toBe('Card'); // canonicalized on ingest (Task 5): "Credit Card" -> "Card"
    // Every field the UI reads is present:
    for (const t of all) {
      for (const k of ['id','date','description','amount','bank','account','categoryId','subcategoryId','note','source','createdAt','modifiedAt']) {
        expect(t).toHaveProperty(k);
      }
    }
  });
});
