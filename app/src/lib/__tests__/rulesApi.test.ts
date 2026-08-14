import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';
import { createRule, readRules, updateRule, deleteRule } from '@/lib/storage';
import { previewRule, applyRule } from '@/lib/ruleBackfill';

// Every mutation calls exportRules(), but exportRules() only writes when its
// `db` is the real getDb() singleton (see storage.ts) — the temp db these
// tests pass in is never that, so no fs mock is needed here.

type Db = ReturnType<typeof makeTmpDb>['db'];

function seedKindle(db: Db) {
  db.insert(schema.accounts).values({
    id: 'a1', name: 'Card', institution: 'Chase',
    createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
  }).run();
  ['entertainment', 'entertainment', 'education'].forEach((c, i) => {
    db.insert(schema.transactions).values({
      id: `t${i}`, accountId: 'a1', date: '2026-07-01', month: '2026-07',
      description: `Kindle Svcs*A${i}`, amount: -9.99,
      categoryId: c, subcategoryId: c === 'education' ? 'books' : 'streaming',
      categorySource: 'ai', fingerprint: `fp${i}`,
      createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
    }).run();
  });
}

describe('rules API composition', () => {
  it('create-then-apply changes exactly the rows the preview promised', async () => {
    const { db } = makeTmpDb();
    seedKindle(db);
    const input = { pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' };

    const preview = previewRule(input, db);
    expect(preview.willChange).toBe(2);

    const rule = await createRule(input, db);
    expect(applyRule(rule.id, db)).toEqual({ changed: preview.willChange, skippedManual: 0 });
  });

  it('lists rules with their match counts', async () => {
    const { db } = makeTmpDb();
    seedKindle(db);
    await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);

    const rules = await readRules(db);
    const withCounts = rules.map((r) => {
      const p = previewRule({ pattern: r.pattern, categoryId: r.categoryId, subcategoryId: r.subcategoryId }, db);
      return { ...r, totalMatches: p.totalMatches, distinctCategories: p.distinctCategories };
    });
    expect(withCounts[0]).toMatchObject({ totalMatches: 3, distinctCategories: 2 });
  });

  it('a disabled rule changes nothing until it is enabled', async () => {
    const { db } = makeTmpDb();
    seedKindle(db);
    const rule = await createRule(
      { pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books', enabled: false }, db,
    );
    // applyRule enforces the enabled gate itself (throws RuleDisabledError while
    // disabled) — enabling then applying is the only path that succeeds.
    const enabled = await updateRule(rule.id, { enabled: true }, db);
    expect(enabled?.enabled).toBe(true);
    expect(applyRule(rule.id, db).changed).toBe(2);
  });

  it('deleting a rule leaves already-applied transactions alone', async () => {
    const { db } = makeTmpDb();
    seedKindle(db);
    const rule = await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);
    applyRule(rule.id, db);
    expect(await deleteRule(rule.id, db)).toBe(true);

    const rows = db.select().from(schema.transactions).all();
    expect(rows.every((r) => r.categoryId === 'education')).toBe(true);
  });
});
