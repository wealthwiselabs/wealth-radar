import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import os from 'os';
import fs from 'fs';
import * as schema from '@/db/schema';

export function makeTmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ettest-'));
  const file = path.join(dir, 'test.db');
  const sqlite = new Database(file);
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), 'src/db/migrations') });
  return { db, file, dir, path: file };
}
