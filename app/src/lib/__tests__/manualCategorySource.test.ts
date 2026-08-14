import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';
import { updateTransaction } from '@/lib/storage';

type Db = ReturnType<typeof makeTmpDb>['db'];

function seedOne(db: Db) {
  db.insert(schema.accounts).values({
    id: 'a1', name: 'Card', institution: 'Chase',
    createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
  }).run();
  db.insert(schema.transactions).values({
    id: 't1', accountId: 'a1', date: '2026-07-01', month: '2026-07',
    description: 'Kindle Svcs*A1', amount: -9.99,
    categoryId: 'entertainment', subcategoryId: 'streaming',
    categorySource: 'ai', fingerprint: 'fp1',
    createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
  }).run();
}

function sourceOf(db: Db): string {
  return db.select().from(schema.transactions).get()!.categorySource;
}

describe('categorySource on edit', () => {
  it('marks the row manual when the caller says so', async () => {
    const { db } = makeTmpDb();
    seedOne(db);
    await updateTransaction('t1', { categoryId: 'education', subcategoryId: 'books', categorySource: 'manual' }, db);
    expect(sourceOf(db)).toBe('manual');
  });

  it('leaves categorySource alone on a note-only edit', async () => {
    const { db } = makeTmpDb();
    seedOne(db);
    await updateTransaction('t1', { note: 'a book' }, db);
    expect(sourceOf(db)).toBe('ai');
  });

  it('does not downgrade an existing manual row', async () => {
    const { db } = makeTmpDb();
    seedOne(db);
    await updateTransaction('t1', { categoryId: 'education', subcategoryId: 'books', categorySource: 'manual' }, db);
    await updateTransaction('t1', { note: 'still a book' }, db);
    expect(sourceOf(db)).toBe('manual');
  });
});
