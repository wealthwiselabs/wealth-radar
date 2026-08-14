import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';
import { previewRule } from '@/lib/ruleBackfill';

type Db = ReturnType<typeof makeTmpDb>['db'];

function seed(db: Db, rows: Array<{
  description: string; categoryId: string; subcategoryId: string; categorySource?: string;
}>) {
  db.insert(schema.accounts).values({
    id: 'a1', name: 'Card', institution: 'Chase',
    createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
  }).run();
  rows.forEach((r, i) => {
    db.insert(schema.transactions).values({
      id: `t${i}`, accountId: 'a1', date: '2026-07-01', month: '2026-07',
      description: r.description, amount: -9.99,
      categoryId: r.categoryId, subcategoryId: r.subcategoryId,
      categorySource: r.categorySource ?? 'ai', fingerprint: `fp${i}`,
      createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
    }).run();
  });
}

const target = { pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' };

describe('previewRule', () => {
  it('splits matches into already-correct, will-change, and manual skips', () => {
    const { db } = makeTmpDb();
    seed(db, [
      { description: 'Kindle Svcs*A1', categoryId: 'education', subcategoryId: 'books' },
      { description: 'Kindle Svcs*A2', categoryId: 'entertainment', subcategoryId: 'streaming' },
      { description: 'Kindle Svcs*A3', categoryId: 'shopping', subcategoryId: 'amazon' },
      { description: 'Kindle Svcs*A4', categoryId: 'entertainment', subcategoryId: 'streaming', categorySource: 'manual' },
      { description: 'SAFEWAY #0700', categoryId: 'food', subcategoryId: 'grocery' },
    ]);
    const p = previewRule(target, db);
    expect(p.totalMatches).toBe(4);
    expect(p.alreadyCorrect).toBe(1);
    expect(p.willChange).toBe(2);
    expect(p.skippedManual).toBe(1);
  });

  it('counts a manual row that already matches the target as a manual skip, not correct', () => {
    const { db } = makeTmpDb();
    seed(db, [
      { description: 'Kindle Svcs*A1', categoryId: 'education', subcategoryId: 'books', categorySource: 'manual' },
    ]);
    const p = previewRule(target, db);
    expect(p.skippedManual).toBe(1);
    expect(p.alreadyCorrect).toBe(0);
    expect(p.willChange).toBe(0);
  });

  it('reports distinct existing categories among matches', () => {
    const { db } = makeTmpDb();
    seed(db, [
      { description: 'Kindle Svcs*A1', categoryId: 'education', subcategoryId: 'books' },
      { description: 'Kindle Svcs*A2', categoryId: 'entertainment', subcategoryId: 'streaming' },
      { description: 'Kindle Svcs*A3', categoryId: 'shopping', subcategoryId: 'amazon' },
    ]);
    expect(previewRule(target, db).distinctCategories).toBe(3);
  });

  it('warns when a pattern spans more than five categories', () => {
    const { db } = makeTmpDb();
    seed(db, ['a', 'b', 'c', 'd', 'e', 'f'].map((c, i) => ({
      description: `AplPay MERCHANT ${i}`, categoryId: c, subcategoryId: 'x',
    })));
    const p = previewRule({ pattern: 'aplpay', categoryId: 'shopping', subcategoryId: 'clothing' }, db);
    expect(p.warnManyCategories).toBe(true);
  });

  it('warns when a pattern matches more than ten percent of all transactions', () => {
    const { db } = makeTmpDb();
    const rows = Array.from({ length: 20 }, (_, i) => ({
      description: i < 3 ? `AplPay SHOP ${i}` : `OTHER MERCHANT ${i}`,
      categoryId: 'shopping', subcategoryId: 'general',
    }));
    seed(db, rows);
    const p = previewRule({ pattern: 'aplpay', categoryId: 'shopping', subcategoryId: 'clothing' }, db);
    expect(p.warnHighMatchRate).toBe(true);
  });

  it('does not warn for a real merchant under both thresholds', () => {
    const { db } = makeTmpDb();
    const rows = Array.from({ length: 40 }, (_, i) => ({
      description: i < 3 ? `TARGET 000${i}` : `OTHER MERCHANT ${i}`,
      categoryId: 'shopping', subcategoryId: 'general',
    }));
    seed(db, rows);
    const p = previewRule({ pattern: 'target', categoryId: 'shopping', subcategoryId: 'general' }, db);
    expect(p.warnHighMatchRate).toBe(false);
    expect(p.warnManyCategories).toBe(false);
  });

  it('returns at most ten samples, all of them rows that will change', () => {
    const { db } = makeTmpDb();
    seed(db, Array.from({ length: 15 }, (_, i) => ({
      description: `Kindle Svcs*A${i}`, categoryId: 'entertainment', subcategoryId: 'streaming',
    })));
    const p = previewRule(target, db);
    expect(p.samples).toHaveLength(10);
    expect(p.samples.every((s) => s.categoryId === 'entertainment')).toBe(true);
  });

  it('returns an empty preview for a pattern that matches nothing', () => {
    const { db } = makeTmpDb();
    seed(db, [{ description: 'SAFEWAY #0700', categoryId: 'food', subcategoryId: 'grocery' }]);
    const p = previewRule(target, db);
    expect(p).toMatchObject({ totalMatches: 0, willChange: 0, samples: [] });
  });
});
