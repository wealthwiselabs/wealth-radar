/**
 * One-off import of the ROI-26 sheet's 2025 quarters.
 *
 * Usage:  npm run investments:import
 *
 * Migrates the database if needed (tsx bypasses the Next.js server-start
 * migration hook in src/instrumentation.ts, so this script must run its own).
 * The migration runs *after* the backup snapshot, never at module load: a
 * migration is itself a write, and a snapshot taken afterwards cannot undo it.
 *
 * Edit PORTFOLIO_ROWS below to match the exported sheet before running. The
 * data is inlined rather than parsed from CSV because the sheet's merged-cell
 * layout differs per tab and a parser would be written once and never reused.
 */
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { snapshotDb } from '@/lib/backup';
import { resolveOrCreateAccount } from '@/lib/accounts';
import { importLegacyQuarters, type LegacyClassRow } from '@/lib/investments/legacyImport';

// Per-asset-class 2025 rows, transcribed from the ROI-26 tab's Start / End /
// Contribution cells (never the sheet's printed % / ROI cells — two are wrong).
// The sheet is asset-class-major, so this is household-level per class, not
// per-account. Every 2025 contribution landed in Bond; class-level returns are
// therefore GROSS of contributions and of the Q2 small-cap consolidation and
// Q3->Q4 stock->bond rebalance. The class rows reconcile to the household grand
// total each quarter (Q1 start = 1,675,448.11), so household returns are exact.
const PORTFOLIO_ROWS: LegacyClassRow[] = [
  {
    className: 'Bond',
    quarters: [
      { label: '2025 Q1', start: '2025-01-01', end: '2025-03-31', startValue: 180131.35, endValue: 206940.09, contributions: 23100.09 },
      { label: '2025 Q2', start: '2025-04-01', end: '2025-06-30', startValue: 206940.09, endValue: 176432.52, contributions: 21000.05 },
      { label: '2025 Q3', start: '2025-07-01', end: '2025-09-30', startValue: 176432.52, endValue: 202784.65, contributions: 19957.36 },
      { label: '2025 Q4', start: '2025-10-01', end: '2025-12-31', startValue: 265323.20, endValue: 271230.31, contributions: 5942.50 },
    ],
  },
  {
    className: 'Total US Index',
    quarters: [
      { label: '2025 Q1', start: '2025-01-01', end: '2025-03-31', startValue: 161348.72, endValue: 135885.62, contributions: 0 },
      { label: '2025 Q2', start: '2025-04-01', end: '2025-06-30', startValue: 135885.62, endValue: 168052.02, contributions: 0 },
      { label: '2025 Q3', start: '2025-07-01', end: '2025-09-30', startValue: 168052.02, endValue: 181030.92, contributions: 0 },
      { label: '2025 Q4', start: '2025-10-01', end: '2025-12-31', startValue: 181030.92, endValue: 184450.67, contributions: 0 },
    ],
  },
  {
    className: 'L-Cap Value',
    quarters: [
      { label: '2025 Q1', start: '2025-01-01', end: '2025-03-31', startValue: 352530.78, endValue: 317473.11, contributions: 0 },
      { label: '2025 Q2', start: '2025-04-01', end: '2025-06-30', startValue: 317473.11, endValue: 449397.08, contributions: 0 },
      { label: '2025 Q3', start: '2025-07-01', end: '2025-09-30', startValue: 449397.08, endValue: 481292.36, contributions: 0 },
      { label: '2025 Q4', start: '2025-10-01', end: '2025-12-31', startValue: 452107.19, endValue: 470882.65, contributions: 0 },
    ],
  },
  {
    className: 'L-Cap Growth',
    quarters: [
      { label: '2025 Q1', start: '2025-01-01', end: '2025-03-31', startValue: 406793.94, endValue: 326809.69, contributions: 0 },
      { label: '2025 Q2', start: '2025-04-01', end: '2025-06-30', startValue: 326809.69, endValue: 553348.00, contributions: 0 },
      { label: '2025 Q3', start: '2025-07-01', end: '2025-09-30', startValue: 553348.00, endValue: 608556.70, contributions: 0 },
      { label: '2025 Q4', start: '2025-10-01', end: '2025-12-31', startValue: 575203.31, endValue: 579898.58, contributions: 0 },
    ],
  },
  {
    className: 'Small Cap Index',
    quarters: [
      { label: '2025 Q1', start: '2025-01-01', end: '2025-03-31', startValue: 257998.99, endValue: 210844.85, contributions: 0 },
      { label: '2025 Q2', start: '2025-04-01', end: '2025-06-30', startValue: 210844.85, endValue: 276421.17, contributions: 0 },
      { label: '2025 Q3', start: '2025-07-01', end: '2025-09-30', startValue: 276421.17, endValue: 295779.77, contributions: 0 },
      { label: '2025 Q4', start: '2025-10-01', end: '2025-12-31', startValue: 295779.77, endValue: 300268.06, contributions: 0 },
    ],
  },
  {
    // Held only through Q2, then consolidated into Small Cap Index (End = 0).
    className: 'S-Cap Value',
    quarters: [
      { label: '2025 Q1', start: '2025-01-01', end: '2025-03-31', startValue: 72473.73, endValue: 59756.01, contributions: 0 },
      { label: '2025 Q2', start: '2025-04-01', end: '2025-06-30', startValue: 59756.01, endValue: 0, contributions: 0 },
    ],
  },
  {
    className: 'S-Cap Growth',
    quarters: [
      { label: '2025 Q1', start: '2025-01-01', end: '2025-03-31', startValue: 79810.69, endValue: 62922.65, contributions: 0 },
      { label: '2025 Q2', start: '2025-04-01', end: '2025-06-30', startValue: 62922.65, endValue: 0, contributions: 0 },
    ],
  },
  {
    className: 'Intl Dev Mkt',
    quarters: [
      { label: '2025 Q1', start: '2025-01-01', end: '2025-03-31', startValue: 99281.87, endValue: 96489.58, contributions: 0 },
      { label: '2025 Q2', start: '2025-04-01', end: '2025-06-30', startValue: 96489.58, endValue: 117719.27, contributions: 0 },
      { label: '2025 Q3', start: '2025-07-01', end: '2025-09-30', startValue: 117719.27, endValue: 126752.27, contributions: 0 },
      { label: '2025 Q4', start: '2025-10-01', end: '2025-12-31', startValue: 126752.27, endValue: 130735.61, contributions: 0 },
    ],
  },
  {
    className: 'Intl EMG Mkt',
    quarters: [
      { label: '2025 Q1', start: '2025-01-01', end: '2025-03-31', startValue: 65078.04, endValue: 63151.74, contributions: 0 },
      { label: '2025 Q2', start: '2025-04-01', end: '2025-06-30', startValue: 63151.74, endValue: 73645.40, contributions: 0 },
      { label: '2025 Q3', start: '2025-07-01', end: '2025-09-30', startValue: 73645.40, endValue: 81868.05, contributions: 0 },
      { label: '2025 Q4', start: '2025-10-01', end: '2025-12-31', startValue: 81868.05, endValue: 86305.54, contributions: 0 },
    ],
  },
];

async function main() {
  // Order matters: back up first, migrate second, everything else third. The
  // migration is an ALTER TABLE plus five CREATE TABLEs against the live file,
  // so it must land on the far side of the snapshot to be recoverable.
  const backup = snapshotDb('pre-roi-import');
  console.log(backup ? `Snapshot written to ${backup}` : 'No snapshot taken (in-memory database)');

  runMigrations();

  const db = getDb();

  const account = await resolveOrCreateAccount({
    institution: 'Legacy',
    name: 'Household Portfolio',
    owner: '',
    mask: null,
    accountClass: 'investment',
    type: 'investment',
    subtype: null,
    origin: 'manual',
  }, db);
  db.update(schema.accounts).set({ purpose: 'portfolio', modifiedAt: new Date().toISOString() })
    .where(eq(schema.accounts.id, account.id)).run();

  const result = await importLegacyQuarters(account.id, PORTFOLIO_ROWS, db);
  console.log(`Imported ${result.snapshots} snapshots and ${result.flows} cash flows into ${account.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
