import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { readRules, createRule, updateRule, deleteRule } from '@/lib/storage';
import { PatternTooShortError, PatternConflictError } from '@/lib/ruleErrors';

describe('rule storage', () => {
  // Every mutation calls exportRules(), but exportRules() only writes when its
  // `db` is the real getDb() singleton (see storage.ts) — the temp db these
  // tests pass in is never that, so no fs mock is needed here.

  it('creates a rule with a normalized pattern, enabled by default', async () => {
    const { db } = makeTmpDb();
    const r = await createRule({ pattern: '  Kindle   Svcs ', categoryId: 'education', subcategoryId: 'books' }, db);
    expect(r.pattern).toBe('kindle svcs');
    expect(r.enabled).toBe(true);
    expect(await readRules(db)).toHaveLength(1);
  });

  it('rejects a pattern shorter than three characters', async () => {
    const { db } = makeTmpDb();
    await expect(
      createRule({ pattern: 'at', categoryId: 'food', subcategoryId: 'coffee' }, db),
    ).rejects.toThrow(PatternTooShortError);
  });

  it('upserts rather than duplicating when the pattern already exists', async () => {
    const { db } = makeTmpDb();
    await createRule({ pattern: 'kindle svcs', categoryId: 'entertainment', subcategoryId: 'streaming' }, db);
    const second = await createRule({ pattern: 'Kindle Svcs', categoryId: 'education', subcategoryId: 'books' }, db);
    const all = await readRules(db);
    expect(all).toHaveLength(1);
    expect(all[0].categoryId).toBe('education');
    expect(all[0].id).toBe(second.id);
  });

  it('updates a rule and bumps updatedAt', async () => {
    const { db } = makeTmpDb();
    const r = await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);
    const updated = await updateRule(r.id, { enabled: false }, db);
    expect(updated?.enabled).toBe(false);
    expect(updated!.updatedAt >= r.updatedAt).toBe(true);
  });

  it('returns null when updating a rule that does not exist', async () => {
    const { db } = makeTmpDb();
    expect(await updateRule('nope', { enabled: false }, db)).toBeNull();
  });

  it('updateRule normalizes a pattern', async () => {
    const { db } = makeTmpDb();
    const r = await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);
    const updated = await updateRule(r.id, { pattern: '  COSTCO   Gas ' }, db);
    expect(updated?.pattern).toBe('costco gas');
  });

  it('updateRule rejects a too-short pattern', async () => {
    const { db } = makeTmpDb();
    const r = await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);
    await expect(
      updateRule(r.id, { pattern: 'at' }, db),
    ).rejects.toThrow(PatternTooShortError);
  });

  it('updateRule rejects a pattern that collides with a different rule', async () => {
    const { db } = makeTmpDb();
    await createRule({ pattern: 'costco', categoryId: 'shopping', subcategoryId: 'groceries' }, db);
    const gas = await createRule({ pattern: 'costco gas', categoryId: 'shopping', subcategoryId: 'gas' }, db);
    await expect(
      updateRule(gas.id, { pattern: 'costco' }, db),
    ).rejects.toThrow(PatternConflictError);
    // The rejected rule keeps its original pattern.
    const all = await readRules(db);
    expect(all.find((r) => r.id === gas.id)?.pattern).toBe('costco gas');
  });

  it('deletes a rule', async () => {
    const { db } = makeTmpDb();
    const r = await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);
    expect(await deleteRule(r.id, db)).toBe(true);
    expect(await deleteRule(r.id, db)).toBe(false);
    expect(await readRules(db)).toHaveLength(0);
  });
});
