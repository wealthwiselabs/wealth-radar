import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import path from 'path';
import { makeTmpDb } from '@/test/tmpDb';
import { snapshotDb } from '@/lib/backup';
import { accounts } from '@/db/schema';

const T = '2026-07-30T00:00:00.000Z';

function acct(db: any, id: string) {
  db.insert(accounts).values({
    id, name: `acct-${id}`, institution: 'Test', accountClass: 'spending', type: 'credit',
    origin: 'manual', status: 'active', createdAt: T, modifiedAt: T,
  }).run();
}

function snapDir(dbFile: string) {
  return path.join(path.dirname(dbFile), 'snapshots');
}

describe('snapshotDb', () => {
  it('writes a snapshot that opens as a valid DB with the same rows', () => {
    const { db, file } = makeTmpDb();
    acct(db, 'a'); acct(db, 'b');

    const out = snapshotDb('pre-sync', { db });

    expect(out).not.toBeNull();
    expect(fs.existsSync(out!)).toBe(true);
    const snap = new Database(out!, { readonly: true });
    const n = snap.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number };
    expect(n.n).toBe(2);
    snap.close();
  });

  it('captures state at snapshot time, not at read time', () => {
    const { db } = makeTmpDb();
    acct(db, 'before');

    const out = snapshotDb('pre-sync', { db })!;
    acct(db, 'after');   // mutate AFTER snapshotting

    const snap = new Database(out, { readonly: true });
    const ids = snap.prepare('SELECT id FROM accounts').all() as { id: string }[];
    expect(ids.map(r => r.id)).toEqual(['before']);
    snap.close();
  });

  it('returns null for an in-memory database instead of throwing', () => {
    const sqlite = new Database(':memory:');
    const memDb = drizzle(sqlite) as any;

    expect(() => snapshotDb('pre-sync', { db: memDb })).not.toThrow();
    expect(snapshotDb('pre-sync', { db: memDb })).toBeNull();
    sqlite.close();
  });

  it('prunes to the newest `keep` snapshots', () => {
    const { db, file } = makeTmpDb();
    acct(db, 'a');

    for (let i = 0; i < 5; i++) {
      snapshotDb('pre-sync', { db, keep: 3, now: new Date(Date.UTC(2026, 6, 30, 0, 0, i)) });
    }

    const files = fs.readdirSync(snapDir(file)).filter(f => f.startsWith('pre-sync-')).sort();
    expect(files).toHaveLength(3);
    // Newest three kept (seconds 02, 03, 04).
    expect(files[2]).toContain('20260730T000004');
  });

  it('prunes per label, so one label cannot evict another', () => {
    const { db, file } = makeTmpDb();
    acct(db, 'a');

    for (let i = 0; i < 6; i++) {
      snapshotDb('pre-sync', { db, keep: 5, now: new Date(Date.UTC(2026, 6, 30, 0, 0, i)) });
    }
    for (let i = 0; i < 2; i++) {
      snapshotDb('manual', { db, keep: 5, now: new Date(Date.UTC(2026, 6, 30, 1, 0, i)) });
    }

    const all = fs.readdirSync(snapDir(file));
    expect(all.filter(f => f.startsWith('pre-sync-'))).toHaveLength(5);
    expect(all.filter(f => f.startsWith('manual-'))).toHaveLength(2);
  });

  it('does not clobber an existing snapshot taken in the same second', () => {
    const { db, file } = makeTmpDb();
    acct(db, 'a');
    const now = new Date(Date.UTC(2026, 6, 30, 0, 0, 0));

    const first = snapshotDb('pre-sync', { db, now });
    const second = snapshotDb('pre-sync', { db, now });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(fs.existsSync(first!)).toBe(true);
    expect(fs.existsSync(second!)).toBe(true);
  });

  it('prunes the oldest even when snapshots collide within one second', () => {
    const { db } = makeTmpDb();
    acct(db, 'a');
    const now = new Date(Date.UTC(2026, 6, 30, 0, 0, 0));

    const first = snapshotDb('pre-sync', { db, keep: 2, now })!;
    const second = snapshotDb('pre-sync', { db, keep: 2, now })!;
    const third = snapshotDb('pre-sync', { db, keep: 2, now })!;

    // Oldest goes; the two most recent survive. Naming must sort by recency.
    expect(fs.existsSync(first)).toBe(false);
    expect(fs.existsSync(second)).toBe(true);
    expect(fs.existsSync(third)).toBe(true);
  });

  it('returns null rather than throwing when the snapshot dir cannot be created', () => {
    const { db, file } = makeTmpDb();
    acct(db, 'a');
    // Occupy the snapshots path with a file so mkdir must fail.
    fs.writeFileSync(snapDir(file), 'not a directory');

    expect(() => snapshotDb('pre-sync', { db })).not.toThrow();
    expect(snapshotDb('pre-sync', { db })).toBeNull();
  });
});
