import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

describe('category rules schema', () => {
  it('stores a rule and defaults enabled to true', () => {
    const { db } = makeTmpDb();
    db.insert(schema.categoryRules).values({
      id: 'r1', pattern: 'kindle svcs',
      categoryId: 'education', subcategoryId: 'books',
      createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
    }).run();
    const row = db.select().from(schema.categoryRules).get();
    expect(row).toMatchObject({ pattern: 'kindle svcs', enabled: true });
  });

  it('rejects two rules with the same pattern', () => {
    const { db } = makeTmpDb();
    const base = {
      categoryId: 'education', subcategoryId: 'books',
      createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z',
    };
    db.insert(schema.categoryRules).values({ id: 'r1', pattern: 'kindle svcs', ...base }).run();
    expect(() =>
      db.insert(schema.categoryRules).values({ id: 'r2', pattern: 'kindle svcs', ...base }).run(),
    ).toThrow();
  });

  it('defaults transactions.categorySource to ai', () => {
    const { db } = makeTmpDb();
    db.insert(schema.accounts).values({
      id: 'a1', name: 'Card', institution: 'Chase',
      createdAt: '2026-07-30T00:00:00.000Z', modifiedAt: '2026-07-30T00:00:00.000Z',
    }).run();
    db.insert(schema.transactions).values({
      id: 't1', accountId: 'a1', date: '2026-07-01', month: '2026-07',
      description: 'Kindle Svcs*ABC', amount: -9.99, fingerprint: 'fp1',
      createdAt: '2026-07-30T00:00:00.000Z', modifiedAt: '2026-07-30T00:00:00.000Z',
    }).run();
    const row = db.select().from(schema.transactions).get();
    expect(row?.categorySource).toBe('ai');
  });
});
