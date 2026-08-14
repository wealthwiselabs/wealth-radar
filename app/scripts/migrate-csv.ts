import path from 'path';
import fs from 'fs';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { parseTransactionsCsv } from '@/lib/csvParse';
import { ingestClassifiedBatch } from '@/lib/ingest';

type Db = ReturnType<typeof getDb>;

export async function importFromDisk(opts: { dataDir: string; db?: Db }): Promise<{ transactions: number; skipped: number }> {
  const db = opts.db ?? getDb();
  let added = 0, skipped = 0;

  const csvPath = path.join(opts.dataDir, 'transactions.csv');
  if (fs.existsSync(csvPath)) {
    const txns = parseTransactionsCsv(fs.readFileSync(csvPath, 'utf-8'));
    // Group by (bank, account, source) so a folder of monthly statements for one
    // account keeps each file's own sourceFile per batch (same fix as addTransactions).
    const groups = new Map<string, typeof txns>();
    for (const t of txns) {
      const key = `${t.bank}|||${t.account}|||${t.source}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
    }
    for (const [key, group] of groups) {
      const [bank, account, source] = key.split('|||');
      const res = await ingestClassifiedBatch({
        account: { institution: bank, name: account }, source: 'pdf',
        sourceFile: source || null,
        transactions: group.map((t) => ({
          date: t.date, description: t.description, amount: t.amount,
          categoryId: t.categoryId, subcategoryId: t.subcategoryId, note: t.note,
        })),
      }, db);
      added += res.added; skipped += res.skipped;
    }
  }

  return { transactions: added, skipped };
}

// CLI entry: `npm run migrate:csv`
if (process.argv[1] && process.argv[1].endsWith('migrate-csv.ts')) {
  runMigrations();
  importFromDisk({ dataDir: path.join(process.cwd(), 'data') }).then((r) => {
    // eslint-disable-next-line no-console
    console.log(`Imported ${r.transactions} transaction(s), skipped ${r.skipped}.`);
  });
}
