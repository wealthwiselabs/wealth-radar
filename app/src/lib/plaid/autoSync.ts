import { getDb, schema } from '@/db/client';
import { syncAllItems } from '@/lib/plaid/sync';
import { syncAllInvestments } from '@/lib/plaid/syncAllInvestments';
import { isPlaidConfigured } from '@/lib/plaid/config';
import { getPlaidClient } from '@/lib/plaid/client';
import type { PlaidApi } from 'plaid';

type Db = ReturnType<typeof getDb>;

const AUTO_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Should the app sync at startup? Yes when it has never synced, or when the
 * newest sync is at least `thresholdHours` old. The boundary (exactly the
 * threshold) counts as due — a run landing precisely on the cadence should
 * sync, not skip.
 *
 * The default is 24h (daily). The app scales to zero on Fly, so this on-boot
 * check — not the in-process interval — is what actually keeps data fresh: a
 * daily external ping (GitHub Actions `daily-refresh`, or the Mac backup's
 * `fly machine start`) cold-starts the process, and this fires the sync when a
 * day has passed.
 */
export function shouldSyncOnStartup(
  lastSyncedAt: string | null,
  now: Date,
  thresholdHours = 24,
): boolean {
  if (!lastSyncedAt) return true;
  const elapsed = now.getTime() - new Date(lastSyncedAt).getTime();
  return elapsed >= thresholdHours * 60 * 60 * 1000;
}

/**
 * The newest `lastSyncedAt` across all Plaid items, or null when none has ever
 * synced. Reflects manual syncs too, so a boot minutes after a manual sync sees
 * a fresh timestamp and skips the redundant startup run.
 */
export function newestSyncedAt(db: Db = getDb()): string | null {
  const values = db.select({ lastSyncedAt: schema.plaidItems.lastSyncedAt })
    .from(schema.plaidItems).all()
    .map((r) => r.lastSyncedAt)
    .filter((v): v is string => Boolean(v));
  if (values.length === 0) return null;
  return values.sort().at(-1)!;   // ISO-8601 sorts lexicographically by time
}

// Used by the scheduler (instrumentation.ts) via the interval; exported so the
// interval and this module share one source of truth for the daily cadence.
export { AUTO_SYNC_INTERVAL_MS };

export interface AutoSyncDeps {
  syncExpenses?: (db?: Db) => Promise<unknown>;
  syncInvestments?: (db: Db, opts: { client: PlaidApi; apiKey?: string }) => Promise<unknown>;
  isConfigured?: () => boolean;
  client?: PlaidApi;
  apiKey?: string;
  db?: Db;
}

// Module-level mutex: a startup sync and an interval tick share this process, so
// a run that lands while another is in flight must join it, not double-sync.
let inFlight: Promise<void> | null = null;

/**
 * One unattended sync: expenses then investments, sequential. Mirrors clicking
 * both manual Sync buttons — holdings are pulled by both entry points, which is
 * idempotent (upsert by snapshot date). Never rejects: each sync is contained,
 * so a failure is logged and the next scheduled run retries. No-ops when Plaid
 * is not configured.
 */
export function runAutoSync(deps: AutoSyncDeps = {}): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const isConfigured = deps.isConfigured ?? isPlaidConfigured;
    if (!isConfigured()) {
      console.info('[autosync] Plaid not configured — skipping');
      return;
    }
    // Resolving deps (getPlaidClient() throws when Plaid isn't configured) and both
    // syncs live inside this one outer try/catch, so a caller that injects
    // isConfigured: () => true without also injecting a client can never escape
    // runAutoSync's "never rejects" contract.
    try {
      const db = deps.db;
      const client = deps.client ?? getPlaidClient();
      const apiKey = deps.apiKey ?? process.env.ANTHROPIC_API_KEY;
      const syncExpenses = deps.syncExpenses ?? syncAllItems;
      const syncInvestments = deps.syncInvestments ?? syncAllInvestments;

      try {
        await syncExpenses(db);
      } catch (err) {
        console.error('[autosync] expense sync failed:', String(err));
      }
      try {
        await syncInvestments(db as Db, { client, apiKey });
      } catch (err) {
        console.error('[autosync] investment sync failed:', String(err));
      }
    } catch (err) {
      console.error('[autosync] setup failed:', String(err));
    }
  })().finally(() => { inFlight = null; });
  return inFlight;
}
