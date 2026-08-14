import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';
import { ingestClassifiedBatch } from '@/lib/ingest';
import { deduplicateTransactions } from '@/lib/storage';
import { readTransactions } from '@/lib/storage';

type Db = ReturnType<typeof makeTmpDb>['db'];

const ACCT = { institution: 'Chase', name: 'Freedom Unlimited', mask: '3128' };

/** Post a PDF-sourced row through the real ingest path. */
async function pdf(db: Db, date: string, description: string, amount: number) {
  await ingestClassifiedBatch({
    account: ACCT, source: 'pdf', sourceFile: 'may.pdf',
    transactions: [{ date, description, amount, categoryId: 'education', subcategoryId: 'books' }],
  }, db);
}

/** Post a Plaid-sourced row for the SAME account through the real ingest path. */
async function plaid(db: Db, date: string, description: string, amount: number, externalId: string) {
  await ingestClassifiedBatch({
    account: ACCT, source: 'plaid', sourceFile: null,
    transactions: [{ date, description, amount, categoryId: 'education', subcategoryId: 'books', externalId }],
  }, db);
}

const rows = (db: Db) => db.select().from(schema.transactions).all();

describe('deduplicateTransactions — cross-source near-duplicates', () => {
  it('collapses a PDF/Plaid pair whose descriptions differ but which are the same charge', async () => {
    const { db } = makeTmpDb();
    await pdf(db, '2026-05-04', 'Kindle Svcs*BV5J31CH1 888-802-3080 WA', -7.99);
    await plaid(db, '2026-05-05', 'Kindle Svcs*BV5J31CH1', -7.99, 'plaid-1');
    expect(await readTransactions(db)).toHaveLength(2);

    const { removed } = await deduplicateTransactions(db);

    expect(removed).toBe(1);
    const visible = await readTransactions(db);
    expect(visible).toHaveLength(1);
    // The PDF row survives — it carries the richer descriptor.
    expect(visible[0].description).toBe('Kindle Svcs*BV5J31CH1 888-802-3080 WA');
  });

  it('supersedes rather than deletes, pointing the Plaid row at the surviving PDF row', async () => {
    const { db } = makeTmpDb();
    await pdf(db, '2026-05-04', 'AMAZON PRIME*4L1OH2P03 Amzn.com/bill WA', -16.45);
    await plaid(db, '2026-05-04', 'Amazon Prime', -16.45, 'plaid-1');

    await deduplicateTransactions(db);

    const all = rows(db);
    expect(all).toHaveLength(2); // nothing physically deleted
    const survivor = all.find((r) => r.source === 'pdf')!;
    const hidden = all.find((r) => r.source === 'plaid')!;
    expect(hidden.supersededBy).toBe(survivor.id);
    expect(survivor.supersededBy).toBeNull();
    // externalId is retained so a later Plaid sync still dedupes against it.
    expect(hidden.externalId).toBe('plaid-1');
  });

  it('does not collapse rows whose amounts differ', async () => {
    const { db } = makeTmpDb();
    await pdf(db, '2026-05-04', 'STARBUCKS 8007827282 800-782-7282 WA', -6.15);
    await plaid(db, '2026-05-04', 'Starbucks', -6.25, 'plaid-1');

    const { removed } = await deduplicateTransactions(db);

    expect(removed).toBe(0);
    expect(await readTransactions(db)).toHaveLength(2);
  });

  it('does not collapse rows dated further apart than the matching window', async () => {
    const { db } = makeTmpDb();
    await pdf(db, '2026-05-01', 'STARBUCKS 8007827282 800-782-7282 WA', -6.15);
    await plaid(db, '2026-05-20', 'Starbucks', -6.15, 'plaid-1');

    const { removed } = await deduplicateTransactions(db);

    expect(removed).toBe(0);
    expect(await readTransactions(db)).toHaveLength(2);
  });

  it('pairs one-to-one when the same charge repeats, leaving unmatched rows alone', async () => {
    // Two real $9.99 charges, both captured twice — plus a third PDF-only charge
    // that Plaid never saw. Only two pairs exist, so only two rows may collapse.
    const { db } = makeTmpDb();
    await pdf(db, '2026-05-04', 'Kindle Svcs*AAA 888-802-3080 WA', -9.99);
    await pdf(db, '2026-05-04', 'Kindle Svcs*BBB 888-802-3080 WA', -9.99);
    await pdf(db, '2026-05-04', 'Kindle Svcs*CCC 888-802-3080 WA', -9.99);
    await plaid(db, '2026-05-05', 'Kindle Svcs*AAA', -9.99, 'plaid-1');
    await plaid(db, '2026-05-05', 'Kindle Svcs*BBB', -9.99, 'plaid-2');

    const { removed } = await deduplicateTransactions(db);

    expect(removed).toBe(2);
    const visible = await readTransactions(db);
    expect(visible).toHaveLength(3);
    expect(visible.every((t) => t.source === 'may.pdf')).toBe(true);
  });

  it('does not collapse two rows from the same source', async () => {
    // Two genuine same-amount charges on consecutive days, both from the PDF.
    const { db } = makeTmpDb();
    await pdf(db, '2026-05-04', 'IN-N-OUT SUNNYVALE SUNNYVALE CA', -18.32);
    await pdf(db, '2026-05-05', 'IN-N-OUT SUNNYVALE SUNNYVALE CA', -18.32);

    const { removed } = await deduplicateTransactions(db);

    expect(removed).toBe(0);
    expect(await readTransactions(db)).toHaveLength(2);
  });

  it('keeps monthly aggregates consistent with the surviving rows', async () => {
    const { db } = makeTmpDb();
    await pdf(db, '2026-05-04', 'Kindle Svcs*BV5J31CH1 888-802-3080 WA', -7.99);
    await plaid(db, '2026-05-05', 'Kindle Svcs*BV5J31CH1', -7.99, 'plaid-1');

    await deduplicateTransactions(db);

    const aggs = db.select().from(schema.monthlyAggregates).all()
      .filter((a) => a.derivedFromTxns);
    const total = aggs.reduce((s, a) => s + a.expenseTotal, 0);
    const count = aggs.reduce((s, a) => s + a.txnCount, 0);
    expect(total).toBeCloseTo(7.99, 2);
    expect(count).toBe(1);
  });
});
