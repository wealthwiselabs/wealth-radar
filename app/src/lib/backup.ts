// Local point-in-time snapshots of the SQLite database, used as undo points
// before destructive operations (see docs/superpowers/specs/2026-07-30-data-safety-snapshots-design.md).
//
// Off-machine backup is a separate concern by an external backup script;
// this module deliberately knows nothing about any host path.
import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { getDb } from '@/db/client';

// Loose shape so this works with both the app database and a test database.
type AnyDb = { all: (q: any) => any; run: (q: any) => any };

const DEFAULT_KEEP = 5;

/** `2026-07-30T12:34:56Z` -> `20260730T123456` */
function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ask the database where it lives, rather than resolving the path from the
 * environment. This is what keeps a test run (which passes its own temp
 * database) from snapshotting the real app.db.
 *
 * Returns '' for an in-memory database.
 */
function resolveDbFile(db: AnyDb): string {
  const rows = db.all(sql.raw('PRAGMA database_list')) as unknown[];
  for (const row of rows ?? []) {
    // Drizzle may hand back objects or positional arrays depending on driver.
    const r = row as Record<string, unknown> & unknown[];
    const name = Array.isArray(row) ? row[1] : r.name;
    const file = Array.isArray(row) ? row[2] : r.file;
    if (name === 'main') return typeof file === 'string' ? file : '';
  }
  return '';
}

/** Keep only the newest `keep` snapshots for this label. Best-effort. */
function prune(dir: string, label: string, keep: number): void {
  const pattern = new RegExp(`^${escapeRegex(label)}-\\d{8}T\\d{6}(_\\d+)?\\.db$`);
  const existing = fs.readdirSync(dir).filter(f => pattern.test(f)).sort();
  for (const stale of existing.slice(0, Math.max(0, existing.length - keep))) {
    try {
      fs.unlinkSync(path.join(dir, stale));
    } catch {
      // A snapshot we can't remove is harmless; the backup itself succeeded.
    }
  }
}

/**
 * Write a consistent snapshot of the database to `<dbDir>/snapshots/`.
 *
 * Never throws — a backup problem must not break the operation it is
 * protecting. Returns the snapshot path, or null if no snapshot was taken.
 */
export function snapshotDb(
  label: string,
  opts: { db?: AnyDb; now?: Date; keep?: number } = {}
): string | null {
  try {
    const db = opts.db ?? (getDb() as unknown as AnyDb);
    const dbFile = resolveDbFile(db);
    if (!dbFile) return null; // in-memory database — nothing on disk to snapshot

    const dir = path.join(path.dirname(dbFile), 'snapshots');
    fs.mkdirSync(dir, { recursive: true });

    // VACUUM INTO refuses to overwrite, so find a free name rather than
    // assuming second-resolution timestamps never collide. The suffix uses '_'
    // (0x5F) rather than '-' (0x2D) so that `foo-TS_2.db` sorts AFTER
    // `foo-TS.db` — pruning orders by filename, and '-' would sort the newer
    // file first and delete it.
    const base = `${label}-${stamp(opts.now ?? new Date())}`;
    let target = path.join(dir, `${base}.db`);
    for (let n = 2; fs.existsSync(target); n++) {
      target = path.join(dir, `${base}_${n}.db`);
    }

    db.run(sql.raw(`VACUUM INTO '${target.replace(/'/g, "''")}'`));

    prune(dir, label, opts.keep ?? DEFAULT_KEEP);
    return target;
  } catch (err) {
    console.warn(`[backup] snapshot "${label}" failed:`, err);
    return null;
  }
}
