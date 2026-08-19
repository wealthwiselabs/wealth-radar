import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, transactions } from '@/db/schema';
import { listTransactionsTool } from '@/lib/agent/tools/read';

const NOW = '2026-08-03T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function seed(db: Db) {
  db.insert(accounts).values({
    id: 'chk', name: 'Checking', institution: 'Bank', accountClass: 'spending',
    type: 'depository', origin: 'manual', status: 'active', createdAt: NOW, modifiedAt: NOW,
  }).run();
  for (let i = 0; i < 5; i++) {
    db.insert(transactions).values({
      id: `t${i}`, accountId: 'chk', date: `2026-07-0${i + 1}`, month: '2026-07', description: `Store ${i}`,
      amount: -(i + 1), categoryId: 'food', subcategoryId: 'groceries', note: '',
      source: 'manual', fingerprint: `fp${i}`, createdAt: NOW, modifiedAt: NOW,
    }).run();
  }
}

describe('list_transactions tool', () => {
  it('is a read-only tool', () => {
    expect(listTransactionsTool.gate).toBe('none');
    expect(listTransactionsTool.spec.name).toBe('list_transactions');
  });

  it('pages results and reports how many more remain', async () => {
    const { db } = makeTmpDb();
    seed(db);
    const { content } = await listTransactionsTool.run({ limit: 2 }, { db });
    expect(content.split('\n').filter((l) => l.includes('id=')).length).toBe(2);
    expect(content).toContain('3 more');
    expect(content).toContain('offset=2');
  });

  it('filters by category', async () => {
    const { db } = makeTmpDb();
    seed(db);
    const { content } = await listTransactionsTool.run({ category: 'nonexistent' }, { db });
    expect(content).toContain('No matching transactions.');
  });
});
