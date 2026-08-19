import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, investmentTransactions } from '@/db/schema';
import { listInvestmentTransactionsTool } from '@/lib/agent/tools/read';

const NOW = '2026-08-03T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function seed(db: Db) {
  db.insert(accounts).values({
    id: 'brk', name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    createdAt: NOW, modifiedAt: NOW,
  }).run();
  for (let i = 0; i < 4; i++) {
    db.insert(investmentTransactions).values({
      id: `it${i}`, accountId: 'brk', plaidInvestmentTxnId: `p${i}`, securityId: null,
      date: `2026-07-0${i + 1}`, name: `Buy ${i}`, amount: 100 + i, type: 'buy', createdAt: NOW, modifiedAt: NOW,
    }).run();
  }
}

describe('list_investment_transactions paging', () => {
  it('limits the page and reports how many more remain', async () => {
    const { db } = makeTmpDb();
    seed(db);
    const { content } = await listInvestmentTransactionsTool.run({ limit: 2 }, { db });
    expect(content.split('\n').filter((l) => l.includes('Buy') || l.includes('buy')).length).toBe(2);
    expect(content).toContain('2 more');
    expect(content).toContain('offset=2');
  });
});
