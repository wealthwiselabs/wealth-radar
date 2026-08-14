export async function register() {
  // Positive-branch guard (not an early return): Next statically replaces
  // process.env.NEXT_RUNTIME per bundle target and dead-code-eliminates this
  // whole block — imports included — out of the edge bundle only when it
  // recognizes this `if (... === 'nodejs') { ... }` shape. An early-return
  // negation is logically equivalent at runtime but isn't recognized the same
  // way, so the edge bundle still tried to pull in better-sqlite3 (via
  // db/migrate) and the autoSync graph, which need Node's fs/path/crypto that
  // the edge runtime doesn't have — every request 500'd as a result.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('./db/migrate');
    runMigrations();

    const { runAutoSync, shouldSyncOnStartup, newestSyncedAt, TWELVE_HOURS_MS } =
      await import('./lib/plaid/autoSync');

    // Armed defensively, before the guarded startup sync below: if the startup
    // guard's own evaluation throws (e.g. newestSyncedAt() hits a DB error), the
    // recurring sync must not be silently disabled for the rest of the process.
    // Every 12h for the life of the process. runAutoSync's mutex makes a tick that
    // lands on a still-running startup sync a no-op rather than a double run. The
    // interval is intentionally never cleared — it lives as long as the process.
    setInterval(() => { void runAutoSync(); }, TWELVE_HOURS_MS);

    // Startup sync, guarded and fire-and-forget. Guarded so frequent dev restarts
    // (and a boot minutes after a manual sync) don't re-hit Plaid; fire-and-forget
    // so a network round-trip or a sync failure never delays or fails boot. The
    // guard evaluation itself is wrapped so a throw here can't take down register().
    try {
      if (shouldSyncOnStartup(newestSyncedAt(), new Date())) {
        void runAutoSync();
      }
    } catch (err) {
      console.error('[autosync] startup guard failed:', String(err));
    }
  }
}
