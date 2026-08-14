import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { addTransactions, readTransactions } from '@/lib/storage';
import { accounts } from '@/db/schema';
import { eq } from 'drizzle-orm';

describe('readTransactions exposes accountClass/accountId', () => {
  it('returns spending by default and reflects an investment account', async () => {
    const { db } = makeTmpDb();
    await addTransactions([{ id:'', date:'2026-01-15', description:'X', amount:-4,
      bank:'Chase', account:'Checking', categoryId:'food', subcategoryId:'x', note:'',
      source:'a.pdf', createdAt:'', modifiedAt:'' } as any], db);
    const [t] = await readTransactions(db);
    expect(t.accountClass).toBe('spending');
    expect(typeof t.accountId).toBe('string');
    // flip that account to investment and re-read
    db.update(accounts).set({ accountClass: 'investment' }).where(eq(accounts.id, t.accountId)).run();
    const [t2] = await readTransactions(db);
    expect(t2.accountClass).toBe('investment');
  });
});
