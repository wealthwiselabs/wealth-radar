import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';
import { createRule } from '@/lib/storage';
import { applyRule } from '@/lib/ruleBackfill';
import { RuleDisabledError, RuleNotFoundError } from '@/lib/ruleErrors';

vi.mock('@/lib/aggregates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/aggregates')>();
  return { ...actual, recomputeMonthlyAggregates: vi.fn(actual.recomputeMonthlyAggregates) };
});
import { recomputeMonthlyAggregates } from '@/lib/aggregates';

// Every mutation calls exportRules(), but exportRules() only writes when its
// `db` is the real getDb() singleton (see storage.ts) — the temp db these
// tests pass in is never that, so no fs mock is needed here.

type Db = ReturnType<typeof makeTmpDb>['db'];

function seed(db: Db, rows: Array<{
  description: string; categoryId: string; subcategoryId: string;
  categorySource?: string; month?: string; accountId?: string;
}>) {
  for (const id of ['a1', 'a2']) {
    db.insert(schema.accounts).values({
      id, name: `Card ${id}`, institution: 'Chase',
      createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
    }).run();
  }
  rows.forEach((r, i) => {
    const month = r.month ?? '2026-07';
    db.insert(schema.transactions).values({
      id: `t${i}`, accountId: r.accountId ?? 'a1',
      date: `${month}-01`, month,
      description: r.description, amount: -9.99,
      categoryId: r.categoryId, subcategoryId: r.subcategoryId,
      categorySource: r.categorySource ?? 'ai', fingerprint: `fp${i}`,
      createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
    }).run();
  });
}

describe('applyRule', () => {
  it('rewrites matching rows and marks them rule-sourced', async () => {
    const { db } = makeTmpDb();
    seed(db, [
      { description: 'Kindle Svcs*A1', categoryId: 'entertainment', subcategoryId: 'streaming' },
      { description: 'Kindle Svcs*A2', categoryId: 'shopping', subcategoryId: 'amazon' },
    ]);
    const rule = await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);

    expect(applyRule(rule.id, db)).toEqual({ changed: 2, skippedManual: 0 });

    const rows = db.select().from(schema.transactions).all();
    expect(rows.every((r) => r.categoryId === 'education' && r.subcategoryId === 'books')).toBe(true);
    expect(rows.every((r) => r.categorySource === 'rule')).toBe(true);
  });

  it('never touches a manually set row', async () => {
    const { db } = makeTmpDb();
    seed(db, [
      { description: 'Kindle Svcs*A1', categoryId: 'entertainment', subcategoryId: 'streaming' },
      { description: 'Kindle Svcs*A2', categoryId: 'entertainment', subcategoryId: 'streaming', categorySource: 'manual' },
    ]);
    const rule = await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);

    expect(applyRule(rule.id, db)).toEqual({ changed: 1, skippedManual: 1 });

    const manual = db.select().from(schema.transactions).all().find((r) => r.id === 't1');
    expect(manual).toMatchObject({ categoryId: 'entertainment', categorySource: 'manual' });
  });

  it('leaves non-matching rows alone', async () => {
    const { db } = makeTmpDb();
    seed(db, [
      { description: 'Kindle Svcs*A1', categoryId: 'entertainment', subcategoryId: 'streaming' },
      { description: 'SAFEWAY #0700', categoryId: 'food', subcategoryId: 'grocery' },
    ]);
    const rule = await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);
    applyRule(rule.id, db);

    const safeway = db.select().from(schema.transactions).all().find((r) => r.description === 'SAFEWAY #0700');
    expect(safeway).toMatchObject({ categoryId: 'food', categorySource: 'ai' });
  });

  it('recomputes aggregates once per affected account-month pair', async () => {
    const { db } = makeTmpDb();
    vi.mocked(recomputeMonthlyAggregates).mockClear();
    seed(db, [
      { description: 'Kindle Svcs*A1', categoryId: 'entertainment', subcategoryId: 'streaming', month: '2026-07', accountId: 'a1' },
      { description: 'Kindle Svcs*A2', categoryId: 'entertainment', subcategoryId: 'streaming', month: '2026-07', accountId: 'a1' },
      { description: 'Kindle Svcs*A3', categoryId: 'entertainment', subcategoryId: 'streaming', month: '2026-08', accountId: 'a1' },
      { description: 'Kindle Svcs*A4', categoryId: 'entertainment', subcategoryId: 'streaming', month: '2026-07', accountId: 'a2' },
    ]);
    const rule = await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);
    applyRule(rule.id, db);

    // 4 rows changed, but only 3 distinct (account, month) pairs.
    expect(vi.mocked(recomputeMonthlyAggregates)).toHaveBeenCalledTimes(3);
  });

  it('does not recompute anything when no row changes', async () => {
    const { db } = makeTmpDb();
    vi.mocked(recomputeMonthlyAggregates).mockClear();
    seed(db, [{ description: 'Kindle Svcs*A1', categoryId: 'education', subcategoryId: 'books' }]);
    const rule = await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);

    expect(applyRule(rule.id, db)).toEqual({ changed: 0, skippedManual: 0 });
    expect(vi.mocked(recomputeMonthlyAggregates)).not.toHaveBeenCalled();
  });

  it('throws for an unknown rule id', () => {
    const { db } = makeTmpDb();
    expect(() => applyRule('nope', db)).toThrow(RuleNotFoundError);
  });

  it('throws RuleDisabledError for a disabled rule and touches no transaction', async () => {
    const { db } = makeTmpDb();
    seed(db, [
      { description: 'Kindle Svcs*A1', categoryId: 'entertainment', subcategoryId: 'streaming' },
      { description: 'Kindle Svcs*A2', categoryId: 'shopping', subcategoryId: 'amazon' },
    ]);
    const before = db.select().from(schema.transactions).all();
    const rule = await createRule(
      { pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books', enabled: false }, db,
    );

    expect(() => applyRule(rule.id, db)).toThrow(RuleDisabledError);

    const after = db.select().from(schema.transactions).all();
    expect(after).toEqual(before);
  });

  // An enabled rule applying normally is already covered by "rewrites matching
  // rows and marks them rule-sourced" above (createRule defaults enabled to
  // true), so no separate test is added here.
});
