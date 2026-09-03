/**
 * Adds fake NET WORTH data (assets, liabilities, and dated balance readings)
 * to the demo dataset behind `/net-worth`.
 *
 * Run it with `npx tsx scripts/seed-demo-networth.ts` (before or after the
 * other demo seeds — this script only adds rows scoped to its own fixed
 * account ids, so it never touches their data).
 *
 * ## Where this writes
 *
 * `data/demo/demo.db`, never `data/app.db`. Same reasoning as `seed-demo.ts`
 * and `seed-demo-investments.ts`: the default below plus the runtime assertion
 * in `assertDemoTarget` make the live file unreachable from here by
 * construction, not by remembering to set an env var.
 *
 * Like `seed-demo-investments.ts` and unlike `seed-demo.ts`, this script does
 * NOT drop the database — it is additive. It is idempotent for its own rows:
 * every account and reading hangs off one of the fixed `nw-demo-*` ids below,
 * and a rerun deletes exactly those before recreating them.
 *
 * Everything below is invented. The SHAPE mirrors a household that owns a
 * home with a mortgage, two cars, an HSA, an IUL, and carries a card balance,
 * because that is the case this feature was designed around — but no real
 * address, account, or amount appears anywhere in it.
 *
 * ## What the fixture deliberately demonstrates
 *
 * - A liability entered as a positive magnitude (the mortgage, the card) that
 *   the app renders on the debt side — sign is derived, never stored.
 * - A Plaid-shaped credit card: accountClass 'spending' with type 'credit',
 *   which `netWorthSide` must still place on the liability side.
 * - An item with NO reading at all (the collectibles), which must be excluded
 *   from the total and NAMED in the exclusion banner rather than counted as 0.
 * - Two items past their review cadence (the cars), so the "needs a look"
 *   strip has something in it.
 * - A mortgage secured by the residence, so the register nests it and shows
 *   derived equity.
 */
import path from 'path';

// Set BEFORE the db client resolves anything — see the comment in
// seed-demo.ts for why this has to be a plain statement here rather than
// something read at call time. `assertDemoTarget` re-checks the resolved path
// at runtime regardless, so an eager caller introduced later still cannot
// reach the live database.
process.env.DATABASE_URL ??= 'file:./data/demo/demo.db';

import { eq, inArray } from 'drizzle-orm';
import { getDb, resolveDbFile } from '@/db/client';
import { accounts, balanceSnapshots } from '@/db/schema';
import { upsertBalanceSnapshot } from '@/lib/netWorth/write';

function assertDemoTarget(): string {
  const file = resolveDbFile();
  const dir = path.basename(path.dirname(file));
  if (dir !== 'demo') {
    throw new Error(
      `Refusing to seed ${file}.\n` +
        "This script only writes to a file inside a directory named 'demo'\n" +
        '(default: data/demo/demo.db). Unset DATABASE_URL, or point it at a\n' +
        'demo directory.',
    );
  }
  return file;
}

const NOW = '2026-08-30T00:00:00.000Z';
const TODAY = '2026-08-30';

interface Item {
  id: string;
  name: string;
  accountClass: 'asset' | 'investment' | 'spending' | 'liability';
  type: string;
  subtype: string;
  reviewIntervalMonths: number | null;
  securedBy?: string;
  /** [asOf, balance] readings, oldest first. Empty = never valued. */
  readings: Array<[string, number]>;
}

// Twenty monthly readings, Jan 2025 -> Aug 2026. The span matters: the demo
// spending and investment fixtures reach back to early 2025, and if net worth
// started later the trend chart would open with a cliff — a vertical jump from
// "only the investment accounts are known" to "everything is known" — which
// reads as a bug rather than as the start of tracking.
const M = [
  '2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01', '2025-05-01', '2025-06-01',
  '2025-07-01', '2025-08-01', '2025-09-01', '2025-10-01', '2025-11-01', '2025-12-01',
  '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01',
  '2026-07-01', '2026-08-01',
];

/** Readings for every month, from a base and a per-month delta. */
const series = (base: number, step: number, jitter: number[] = []): Array<[string, number]> =>
  M.map((d, i) => [d, Math.round(base + step * i + (jitter[i] ?? 0))] as [string, number]);

const ITEMS: Item[] = [
  // --- Assets -------------------------------------------------------------
  {
    id: 'nw-demo-residence', name: 'Primary residence',
    accountClass: 'asset', type: 'property', subtype: 'real_estate',
    reviewIntervalMonths: 12,
    // Property is revalued in steps, not continuously — flat, then a jump.
    readings: [['2025-01-01', 1_040_000], ['2025-08-01', 1_075_000], ['2026-03-01', 1_100_000],
      ['2026-08-01', 1_150_000]],
  },
  {
    id: 'nw-demo-car-1', name: 'Honda CR-V',
    accountClass: 'asset', type: 'vehicles', subtype: 'vehicle',
    // Deliberately stale: last valued 14 months ago against a 12-month cadence,
    // so the "needs a look" strip has something real in it.
    reviewIntervalMonths: 12,
    readings: [['2025-05-01', 29_400]],
  },
  {
    id: 'nw-demo-car-2', name: 'Subaru Outback',
    accountClass: 'asset', type: 'vehicles', subtype: 'vehicle',
    reviewIntervalMonths: 12,
    readings: [['2025-05-01', 20_800]],
  },
  {
    id: 'nw-demo-hsa', name: 'HSA',
    accountClass: 'investment', type: 'investments', subtype: 'hsa',
    reviewIntervalMonths: 3,
    readings: series(31_000, 560, [0, 120, -80, 200, 60, -140, 210, 90, 300, -60, 180, 40,
      -220, 130, 75, -110, 260, 30, -95, 150]),
  },
  {
    id: 'nw-demo-iul', name: 'IUL cash value',
    accountClass: 'investment', type: 'other', subtype: 'insurance',
    reviewIntervalMonths: 12,
    // Cash surrender value, not the death benefit — the catalog hint's whole point.
    readings: series(55_500, 640),
  },
  {
    id: 'nw-demo-checking', name: 'Everyday checking',
    accountClass: 'spending', type: 'cash', subtype: 'checking',
    reviewIntervalMonths: 1,
    readings: series(19_500, 220, [0, -1_400, 900, -600, 1_800, -2_100, 400, 1_100, -300, 700,
      -1_250, 1_600, -900, 300, 1_400, -1_700, 850, -400, 1_150, -650]),
  },
  {
    id: 'nw-demo-savings', name: 'Savings',
    accountClass: 'spending', type: 'cash', subtype: 'savings',
    reviewIntervalMonths: 1,
    readings: series(41_000, 990),
  },
  {
    id: 'nw-demo-brokerage', name: 'Taxable brokerage',
    accountClass: 'investment', type: 'investments', subtype: 'brokerage',
    reviewIntervalMonths: 3,
    readings: series(519_000, 6_800, [0, 9_800, -14_200, 4_100, 11_600, -6_900, 8_300, 2_400, 12_100,
      -18_400, 7_600, 15_200, -9_100, 3_300, 13_800, -11_500, 6_400, 1_900, -7_200, 10_600]),
  },
  {
    id: 'nw-demo-collectibles', name: 'Collectibles',
    accountClass: 'asset', type: 'other', subtype: 'collectible',
    reviewIntervalMonths: 12,
    // Deliberately NEVER valued: it must be excluded from the total and named
    // in the exclusion banner, never quietly counted as zero.
    readings: [],
  },

  // --- Liabilities --------------------------------------------------------
  {
    id: 'nw-demo-mortgage', name: 'Mortgage',
    accountClass: 'liability', type: 'loan', subtype: 'mortgage',
    // A loan balance is read off a statement, not estimated — it never goes stale.
    reviewIntervalMonths: null,
    securedBy: 'nw-demo-residence',
    // Entered as what you OWE: a positive magnitude, amortising down.
    readings: series(657_000, -1_930),
  },
  {
    id: 'nw-demo-card', name: 'Rewards card',
    // Plaid shape: cards are accountClass 'spending' with type 'credit', and
    // netWorthSide must still put them on the liability side. Changing this to
    // 'liability' would defeat the case the fixture exists to exercise.
    accountClass: 'spending', type: 'credit', subtype: 'credit',
    reviewIntervalMonths: null,
    readings: series(5_100, 105, [0, 1_400, -900, 2_100, -1_600, 800, -400, 1_900, -1_100, 1_300,
      -1_800, 2_400, -700, 1_100, -1_500, 900, -300, 1_700, -1_200, 600]),
  },
];

/**
 * The spending accounts `seed-demo.ts` creates, given balances as if Plaid had
 * supplied them.
 *
 * Without these they show up as items with no reading — which is CORRECT and is
 * exactly the gap Phase 2 fills, but it puts three confusingly-named rows in the
 * exclusion banner and buries the one unvalued item this fixture means to
 * demonstrate. Giving them `source: 'plaid'` readings instead makes the fixture
 * show both write paths side by side: hand-entered values and synced ones.
 *
 * Matched by (institution, name) rather than id, because `seed-demo.ts` mints a
 * fresh uuid for each of these on every run.
 */
const SYNCED: Array<{ institution: string; name: string; base: number; step: number }> = [
  { institution: 'Ally', name: 'Checking', base: 14_900, step: 175 },
  { institution: 'Chase', name: 'Sapphire', base: 7_300, step: 95 },
  // An Amex, typed 'credit' — netWorthSide must put it on the liability side
  // despite its accountClass being 'spending'.
  { institution: 'Amex', name: 'Everyday', base: 2_100, step: 52 },
];

async function main() {
  const file = assertDemoTarget();
  const db = getDb();
  const ids = ITEMS.map((i) => i.id);

  // Resolve the synced accounts up front so their readings can be cleared on a
  // rerun the same way our own are. If seed-demo.ts has not run, they are simply
  // absent and this whole step is skipped.
  const syncedRows = SYNCED.map((s) => {
    const row = db.select().from(accounts)
      .where(eq(accounts.name, s.name)).all()
      .find((a) => a.institution === s.institution);
    return row ? { ...s, id: row.id } : null;
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  // Idempotent for our own rows only: drop readings first (FK), then accounts.
  // The synced accounts belong to seed-demo.ts, so only their READINGS are
  // cleared here — the accounts themselves are left entirely alone.
  db.delete(balanceSnapshots).where(inArray(balanceSnapshots.accountId, ids)).run();
  db.delete(accounts).where(inArray(accounts.id, ids)).run();
  if (syncedRows.length > 0) {
    db.delete(balanceSnapshots)
      .where(inArray(balanceSnapshots.accountId, syncedRows.map((s) => s.id))).run();
  }

  for (const item of ITEMS) {
    db.insert(accounts).values({
      id: item.id,
      name: item.name,
      institution: 'Manual',
      owner: '',
      accountClass: item.accountClass,
      purpose: 'portfolio',
      type: item.type,
      subtype: item.subtype,
      origin: 'manual',
      status: 'active',
      reviewIntervalMonths: item.reviewIntervalMonths,
      securedByAccountId: item.securedBy ?? null,
      valuationProvider: null,
      valuationRef: null,
      createdAt: NOW,
      modifiedAt: NOW,
    }).run();
  }

  // Readings go through the real write path, so the fixture exercises the same
  // upsert and precedence rules the app uses rather than a parallel one.
  let written = 0;
  for (const item of ITEMS) {
    for (const [asOf, balance] of item.readings) {
      await upsertBalanceSnapshot(
        { accountId: item.id, asOf, balance, source: 'manual' }, db);
      written += 1;
    }
  }

  // Synced balances, written with source 'plaid' so the register shows them
  // alongside the hand-entered ones exactly as Phase 2 would.
  let synced = 0;
  for (const s of syncedRows) {
    for (const [i, asOf] of M.entries()) {
      await upsertBalanceSnapshot(
        { accountId: s.id, asOf, balance: s.base + s.step * i, source: 'plaid' }, db);
      synced += 1;
    }
  }

  const unvalued = ITEMS.filter((i) => i.readings.length === 0).map((i) => i.name);
  console.log(`Seeded ${ITEMS.length} net worth items and ${written} readings into ${file}`);
  console.log(`  plus ${synced} plaid-sourced readings across ${syncedRows.length} existing demo accounts`);
  console.log(`  as of ${TODAY}`);
  console.log(`  deliberately unvalued (should appear in the exclusion banner): ${unvalued.join(', ')}`);
  console.log('  deliberately stale (should appear in "needs a look"): Honda CR-V, Subaru Outback');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
