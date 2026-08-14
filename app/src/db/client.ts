// NOTE: no 'server-only' guard — the DB layer is intentionally reusable by tsx CLI scripts (db:migrate, migrate:csv). Revisit a server/client boundary in the Plaid phase.
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import fs from 'fs';
import * as schema from './schema';

let _db: BetterSQLite3Database<typeof schema> | null = null;

export function resolveDbFile(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/app.db';
  const file = url.startsWith('file:') ? url.slice('file:'.length) : url;
  return path.isAbsolute(file) ? file : path.join(process.cwd(), file);
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (_db) return _db;
  const file = resolveDbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  _db = drizzle(sqlite, { schema });
  return _db;
}

/**
 * True only if `db` is the exact memoized production-database handle held by
 * getDb(). Deliberately does NOT call getDb(): callers that just want to ask
 * "is this the real db?" (e.g. exportRules's guard against clobbering the
 * user's data/preferences.json from a test or script) must be able to do so
 * without ever creating/opening the production database as a side effect,
 * and without risking an fs/sqlite exception escaping what is meant to be a
 * best-effort, never-throw check. If the singleton hasn't been initialized
 * yet, no `db` can possibly be it, so this returns false immediately with no
 * I/O and no construction.
 */
export function isProductionDb(db: unknown): boolean {
  return _db !== null && db === _db;
}

export { schema };
