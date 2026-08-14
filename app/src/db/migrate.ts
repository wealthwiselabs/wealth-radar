import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import { getDb } from './client';

export function runMigrations(db = getDb()): void {
  migrate(db, { migrationsFolder: path.join(process.cwd(), 'src/db/migrations') });
}

// Allow `tsx src/db/migrate.ts` to run migrations directly.
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  runMigrations();
  // eslint-disable-next-line no-console
  console.log('Migrations applied.');
}
