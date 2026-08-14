import { describe, it, expect } from 'vitest';
import { parseSecurityTags } from '@/lib/investments/classifySecurities';

describe('parseSecurityTags', () => {
  it('keeps valid equity tags and normalizes the finer dimensions', () => {
    const text = JSON.stringify([
      { id: 'a', assetType: 'equity', region: 'us', cap: 'large', style: 'growth', sector: null },
    ]);
    expect(parseSecurityTags(text)).toEqual([
      { id: 'a', assetType: 'equity', region: 'us', cap: 'large', style: 'growth', sector: null },
    ]);
  });

  it('coerces an out-of-vocabulary assetType to "other" and clears finer dims', () => {
    const text = JSON.stringify([
      { id: 'a', assetType: 'crypto', region: 'us', cap: 'large', style: 'growth', sector: null },
    ]);
    expect(parseSecurityTags(text)).toEqual([
      { id: 'a', assetType: 'other', region: null, cap: null, style: null, sector: null },
    ]);
  });

  it('forces region/cap/style/sector to null for a non-equity assetType (a bond fund)', () => {
    const text = JSON.stringify([
      { id: 'b', assetType: 'bond', region: 'us', cap: 'large', style: 'value', sector: 'technology' },
    ]);
    expect(parseSecurityTags(text)).toEqual([
      { id: 'b', assetType: 'bond', region: null, cap: null, style: null, sector: null },
    ]);
  });

  it('coerces out-of-vocabulary finer dims on an equity to null, keeps valid ones', () => {
    const text = JSON.stringify([
      { id: 'c', assetType: 'equity', region: 'moon', cap: 'huge', style: 'growth', sector: 'energy' },
    ]);
    expect(parseSecurityTags(text)).toEqual([
      { id: 'c', assetType: 'equity', region: null, cap: null, style: 'growth', sector: null },
    ]);
  });

  it('tolerates a ```json fenced body and drops rows without a string id', () => {
    const text = '```json\n' + JSON.stringify([
      { id: 'd', assetType: 'cash' },
      { assetType: 'equity' },
    ]) + '\n```';
    expect(parseSecurityTags(text)).toEqual([
      { id: 'd', assetType: 'cash', region: null, cap: null, style: null, sector: null },
    ]);
  });

  it('returns [] for unparseable text', () => {
    expect(parseSecurityTags('not json at all')).toEqual([]);
  });
});

import { classifyUntaggedSecurities, classifyInChunks, CLASSIFY_CHUNK_SIZE, type SecurityTag, type SecurityToClassify, type ClassifyFn } from '@/lib/investments/classifySecurities';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

describe('classifyInChunks', () => {
  const mkSecs = (n: number): SecurityToClassify[] =>
    Array.from({ length: n }, (_, i) => ({ id: `s${i}`, ticker: null, name: `S${i}`, kind: 'etf' }));
  const tagAll: ClassifyFn = async (b) =>
    b.map((s): SecurityTag => ({ id: s.id, assetType: 'equity', region: 'us', cap: 'large', style: 'blend', sector: null }));

  it('splits into batches of the given size and concatenates every result', async () => {
    const batchSizes: number[] = [];
    const spy: ClassifyFn = async (b) => { batchSizes.push(b.length); return tagAll(b); };
    const tags = await classifyInChunks(mkSecs(30), spy, 12);
    expect(batchSizes).toEqual([12, 12, 6]);   // 3 calls, not one 30-wide call
    expect(tags.map((t) => t.id)).toEqual(mkSecs(30).map((s) => s.id));
  });

  it('makes a single call when the input fits in one chunk', async () => {
    let calls = 0;
    const spy: ClassifyFn = async (b) => { calls += 1; return tagAll(b); };
    const tags = await classifyInChunks(mkSecs(5), spy, 12);
    expect(calls).toBe(1);
    expect(tags).toHaveLength(5);
  });

  it('exposes a sane default chunk size (small enough to stay under the API timeout)', () => {
    expect(CLASSIFY_CHUNK_SIZE).toBeGreaterThan(0);
    expect(CLASSIFY_CHUNK_SIZE).toBeLessThanOrEqual(25);
  });
});

function insertSecurity(db: ReturnType<typeof makeTmpDb>['db'], over: Partial<typeof schema.securities.$inferInsert> & { id: string }) {
  const now = new Date().toISOString();
  db.insert(schema.securities).values({
    id: over.id, ticker: over.ticker ?? null, name: over.name ?? over.id,
    kind: over.kind ?? 'etf', assetType: over.assetType ?? 'equity',
    region: over.region ?? null, cap: over.cap ?? null, style: over.style ?? null, sector: over.sector ?? null,
    tagSource: over.tagSource ?? 'plaid', createdAt: now, modifiedAt: now,
  }).run();
}

describe('classifyUntaggedSecurities', () => {
  it('tags plaid/seed securities as ai-confirmed and leaves ai-confirmed/user untouched', async () => {
    const { db } = makeTmpDb();
    insertSecurity(db, { id: 'p1', ticker: 'PTTRX', name: 'PIMCO Total Return', tagSource: 'plaid', assetType: 'equity' });
    insertSecurity(db, { id: 's1', ticker: 'VB', name: 'Vanguard Small Cap', tagSource: 'seed', assetType: 'other' });
    insertSecurity(db, { id: 'u1', ticker: 'FOO', name: 'User Tagged', tagSource: 'user', assetType: 'equity' });
    insertSecurity(db, { id: 'a1', ticker: 'BAR', name: 'AI Tagged', tagSource: 'ai-confirmed', assetType: 'equity' });

    const fake: ClassifyFn = async (secs) => secs.map((s): SecurityTag => (
      s.ticker === 'PTTRX'
        ? { id: s.id, assetType: 'bond', region: null, cap: null, style: null, sector: null }
        : { id: s.id, assetType: 'equity', region: 'us', cap: 'small', style: 'blend', sector: null }
    ));

    const res = await classifyUntaggedSecurities(db, { classify: fake });
    expect(res).toEqual({ classified: 2, failed: false });

    const rows = db.select().from(schema.securities).all();
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.p1).toMatchObject({ assetType: 'bond', tagSource: 'ai-confirmed' });
    expect(by.s1).toMatchObject({ assetType: 'equity', region: 'us', cap: 'small', style: 'blend', tagSource: 'ai-confirmed' });
    expect(by.u1).toMatchObject({ assetType: 'equity', tagSource: 'user' });      // untouched
    expect(by.a1).toMatchObject({ tagSource: 'ai-confirmed' });                    // not re-selected (still equity, unchanged)
  });

  it('makes no call and reports nothing when there are no untagged securities', async () => {
    const { db } = makeTmpDb();
    insertSecurity(db, { id: 'u1', tagSource: 'user' });
    let called = false;
    const fake: ClassifyFn = async (s) => { called = true; return []; };
    const res = await classifyUntaggedSecurities(db, { classify: fake });
    expect(called).toBe(false);
    expect(res).toEqual({ classified: 0, failed: false });
  });

  it('leaves rows unchanged and reports failed when the classifier throws', async () => {
    const { db } = makeTmpDb();
    insertSecurity(db, { id: 'p1', ticker: 'VB', name: 'Vanguard Small Cap', tagSource: 'plaid', assetType: 'equity' });
    const fake: ClassifyFn = async () => { throw new Error('boom'); };
    const res = await classifyUntaggedSecurities(db, { classify: fake });
    expect(res).toEqual({ classified: 0, failed: true });
    const row = db.select().from(schema.securities).all()[0];
    expect(row).toMatchObject({ tagSource: 'plaid' });
  });
});

import { coerceTagPatch } from '@/lib/investments/classifySecurities';

describe('coerceTagPatch', () => {
  it('accepts a valid equity tag and keeps finer dims', () => {
    expect(coerceTagPatch({ assetType: 'equity', region: 'us', cap: 'large', style: 'growth', sector: 'technology' }))
      .toEqual({ assetType: 'equity', region: 'us', cap: 'large', style: 'growth', sector: 'technology' });
  });
  it('forces finer dims null for a non-equity assetType', () => {
    expect(coerceTagPatch({ assetType: 'bond', region: 'us', cap: 'large' }))
      .toEqual({ assetType: 'bond', region: null, cap: null, style: null, sector: null });
  });
  it('coerces out-of-vocab finer dims on an equity to null', () => {
    expect(coerceTagPatch({ assetType: 'equity', region: 'moon', cap: 'huge', style: 'growth' }))
      .toEqual({ assetType: 'equity', region: null, cap: null, style: 'growth', sector: null });
  });
  it('rejects (null) an unknown or absent assetType', () => {
    expect(coerceTagPatch({ assetType: 'crypto' })).toBeNull();
    expect(coerceTagPatch({})).toBeNull();
  });
});

import { applyTagCorrection } from '@/lib/investments/classifySecurities';

describe('applyTagCorrection', () => {
  it('persists a valid equity correction with tag_source=user', () => {
    const { db } = makeTmpDb();
    insertSecurity(db, { id: 'x1', ticker: 'VB', name: 'Vanguard Small Cap', tagSource: 'plaid', assetType: 'other' });
    const res = applyTagCorrection(db, 'x1', { assetType: 'equity', region: 'us', cap: 'small', style: 'blend' });
    expect(res).toEqual({ ok: true });
    const row = db.select().from(schema.securities).all().find((s) => s.id === 'x1')!;
    expect(row).toMatchObject({ assetType: 'equity', region: 'us', cap: 'small', style: 'blend', tagSource: 'user' });
  });

  it('rejects invalid values (unknown assetType) and leaves the row unchanged', () => {
    const { db } = makeTmpDb();
    insertSecurity(db, { id: 'x1', tagSource: 'plaid', assetType: 'equity' });
    const res = applyTagCorrection(db, 'x1', { assetType: 'crypto' });
    expect(res).toEqual({ ok: false, reason: 'invalid' });
    expect(db.select().from(schema.securities).all()[0]).toMatchObject({ tagSource: 'plaid' });
  });

  it('returns not_found for an unknown id', () => {
    const { db } = makeTmpDb();
    expect(applyTagCorrection(db, 'nope', { assetType: 'bond' })).toEqual({ ok: false, reason: 'not_found' });
  });

  it('a user-corrected tag is never overwritten by a later classify run', async () => {
    const { db } = makeTmpDb();
    insertSecurity(db, { id: 'x1', ticker: 'VB', name: 'Vanguard Small Cap', tagSource: 'plaid', assetType: 'other' });
    applyTagCorrection(db, 'x1', { assetType: 'bond' });
    const fake: ClassifyFn = async (secs) => secs.map((s): SecurityTag => ({ id: s.id, assetType: 'equity', region: 'us', cap: 'small', style: 'blend', sector: null }));
    const res = await classifyUntaggedSecurities(db, { classify: fake });
    expect(res.classified).toBe(0); // 'user' rows are never selected
    expect(db.select().from(schema.securities).all()[0]).toMatchObject({ assetType: 'bond', tagSource: 'user' });
  });
});

describe('applyTagCorrection — kind', () => {
  it('persists a valid kind and preserves other tags', () => {
    const { db } = makeTmpDb();
    insertSecurity(db, { id: 'k1', ticker: 'RBLX', name: 'Roblox', tagSource: 'plaid', assetType: 'equity', kind: 'etf' });
    const res = applyTagCorrection(db, 'k1', { assetType: 'equity', region: 'us', cap: 'mid', style: 'growth', kind: 'stock' });
    expect(res).toEqual({ ok: true });
    const row = db.select().from(schema.securities).all().find((r) => r.id === 'k1')!;
    expect(row.kind).toBe('stock');
    expect(row.assetType).toBe('equity');
    expect(row.cap).toBe('mid');
  });
  it('ignores an invalid kind, leaving the stored kind untouched', () => {
    const { db } = makeTmpDb();
    insertSecurity(db, { id: 'k2', ticker: 'VTI', name: 'VTI', tagSource: 'plaid', assetType: 'equity', kind: 'etf' });
    const res = applyTagCorrection(db, 'k2', { assetType: 'equity', kind: 'banana' });
    expect(res).toEqual({ ok: true });
    const row = db.select().from(schema.securities).all().find((r) => r.id === 'k2')!;
    expect(row.kind).toBe('etf');
  });
});
