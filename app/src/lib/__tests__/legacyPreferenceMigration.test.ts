import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import os from 'os';
import fs from 'fs';
import * as schema from '@/db/schema';

/**
 * Migrate to 3101, insert legacy preference rows the way the old app did, then
 * migrate the rest of the way and assert they arrive as disabled rules.
 *
 * `seed` runs after migration 3101 (category_rules exists, merchant_preferences
 * exists) and before migration 0004 (the import), so callers can insert
 * pre-existing category_rules rows and/or legacy merchant_preferences rows.
 */
function migrateWithLegacyData(seed?: (sqlite: Database.Database) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etmig-'));
  const file = path.join(dir, 'test.db');
  const sqlite = new Database(file);
  const folder = path.join(process.cwd(), 'src/db/migrations');

  const journalPath = path.join(folder, 'meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
  const upTo3 = { ...journal, entries: journal.entries.filter((e: { idx: number }) => e.idx <= 3) };

  const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'etmigpart-'));
  fs.cpSync(folder, partial, { recursive: true });
  fs.writeFileSync(path.join(partial, 'meta/_journal.json'), JSON.stringify(upTo3));

  migrate(drizzle(sqlite, { schema }), { migrationsFolder: partial });

  sqlite.prepare(
    `INSERT INTO merchant_preferences (merchant_key, category_id, subcategory_id, count, last_used)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('kindle', 'education', 'books', 12, '2026-07-30');
  sqlite.prepare(
    `INSERT INTO merchant_preferences (merchant_key, category_id, subcategory_id, count, last_used)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('APLPAY', 'shopping', 'clothing', 6, '2026-07-31');

  seed?.(sqlite);

  migrate(drizzle(sqlite, { schema }), { migrationsFolder: folder });
  return sqlite;
}

describe('legacy preference migration', () => {
  it('imports every preference as a disabled rule with a lowercased pattern', () => {
    const sqlite = migrateWithLegacyData();
    const rows = sqlite.prepare('SELECT pattern, category_id, subcategory_id, enabled FROM category_rules ORDER BY pattern').all();
    expect(rows).toEqual([
      { pattern: 'aplpay', category_id: 'shopping', subcategory_id: 'clothing', enabled: 0 },
      { pattern: 'kindle', category_id: 'education', subcategory_id: 'books', enabled: 0 },
    ]);
  });

  it('drops the merchant_preferences table', () => {
    const sqlite = migrateWithLegacyData();
    const found = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='merchant_preferences'",
    ).get();
    expect(found).toBeUndefined();
  });

  it('skips a legacy row whose pattern already exists in category_rules, leaving the existing rule unchanged', () => {
    const sqlite = migrateWithLegacyData((db) => {
      // Pattern 'kindle' collides with the legacy 'kindle' merchant_key inserted
      // by migrateWithLegacyData. This pre-existing rule must survive untouched.
      db.prepare(
        `INSERT INTO category_rules (id, pattern, category_id, subcategory_id, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('preexisting-id', 'kindle', 'existing-cat', 'existing-sub', 1, '2026-01-01', '2026-01-01');
    });

    const rows = sqlite.prepare(
      'SELECT id, pattern, category_id, subcategory_id, enabled FROM category_rules WHERE pattern = ?',
    ).all('kindle');
    expect(rows).toEqual([
      { id: 'preexisting-id', pattern: 'kindle', category_id: 'existing-cat', subcategory_id: 'existing-sub', enabled: 1 },
    ]);
  });

  it('collapses legacy keys that differ only by case/whitespace into exactly one disabled rule', () => {
    const sqlite = migrateWithLegacyData((db) => {
      db.prepare(
        `INSERT INTO merchant_preferences (merchant_key, category_id, subcategory_id, count, last_used)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('Costco', 'shopping', 'groceries-old', 3, '2026-01-01');
      db.prepare(
        `INSERT INTO merchant_preferences (merchant_key, category_id, subcategory_id, count, last_used)
         VALUES (?, ?, ?, ?, ?)`,
      ).run('costco ', 'shopping', 'groceries-new', 9, '2026-06-01');
    });

    const rows = sqlite.prepare(
      'SELECT pattern, category_id, subcategory_id, enabled FROM category_rules WHERE pattern = ?',
    ).all('costco');
    // Deterministic: the more recently used ('costco ', last_used 2026-06-01) wins.
    expect(rows).toEqual([
      { pattern: 'costco', category_id: 'shopping', subcategory_id: 'groceries-new', enabled: 0 },
    ]);
  });
});
