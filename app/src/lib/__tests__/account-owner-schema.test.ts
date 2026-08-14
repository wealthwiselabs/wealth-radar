import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts } from '@/db/schema';

const now = '2026-07-30T00:00:00.000Z';
function ins(db: any, id: string, owner: string, name: string, mask: string | null) {
  db.insert(accounts).values({
    id, name, institution: 'Chase', owner, mask, nameSource: 'derived',
    accountClass: 'spending', type: 'credit', origin: 'manual', status: 'active',
    createdAt: now, modifiedAt: now,
  }).run();
}

describe('accounts owner schema', () => {
  it('defaults owner to empty and nameSource to derived', () => {
    const { db } = makeTmpDb();
    db.insert(accounts).values({
      id: 'A', name: 'Sapphire', institution: 'Chase', accountClass: 'spending',
      type: 'credit', origin: 'manual', status: 'active', createdAt: now, modifiedAt: now,
    }).run();
    const row = db.select().from(accounts).all()[0];
    expect(row.owner).toBe('');
    expect(row.nameSource).toBe('derived');
  });

  it('permits two same-product cards distinguished only by mask', () => {
    const { db } = makeTmpDb();
    ins(db, 'A', 'Alex', 'Freedom', '3128');
    ins(db, 'B', 'Alex', 'Freedom', '3119');
    expect(db.select().from(accounts).all()).toHaveLength(2);
  });

  it('permits the same product for two different owners', () => {
    const { db } = makeTmpDb();
    ins(db, 'A', 'Alex', 'United', '3113');
    ins(db, 'B', 'Sam', 'United', '3103');
    expect(db.select().from(accounts).all()).toHaveLength(2);
  });

  it('rejects an exact (owner, institution, name, mask) duplicate', () => {
    const { db } = makeTmpDb();
    ins(db, 'A', 'Alex', 'Freedom', '3128');
    expect(() => ins(db, 'B', 'Alex', 'Freedom', '3128')).toThrow();
  });

  it('rejects two mask-less rows sharing owner/institution/name', () => {
    const { db } = makeTmpDb();
    ins(db, 'A', 'Alex', 'Checking', null);
    expect(() => ins(db, 'B', 'Alex', 'Checking', null)).toThrow();
  });
});
