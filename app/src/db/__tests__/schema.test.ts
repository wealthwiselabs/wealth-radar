import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts } from '@/db/schema';

describe('schema/migrations', () => {
  it('creates tables and inserts an account', () => {
    const { db } = makeTmpDb();
    const now = '2026-07-11T00:00:00.000Z';
    db.insert(accounts).values({
      id: 'a1', name: 'Credit Card', institution: 'Chase',
      accountClass: 'spending', type: 'credit', origin: 'manual',
      status: 'active', createdAt: now, modifiedAt: now,
    }).run();
    const rows = db.select().from(accounts).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].institution).toBe('Chase');
  });
});
