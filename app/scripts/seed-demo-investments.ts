/**
 * Adds fake INVESTMENT data (accounts, snapshots, holdings, reserve flows,
 * transactions) to the demo dataset behind `/investments` and
 * `/investments/reserve`.
 *
 * Run it with `npx tsx scripts/seed-demo-investments.ts` (after or before
 * `npm run demo:seed` — this script only adds rows scoped to its own fixed
 * account ids, so it never touches the spending data `seed-demo.ts` writes).
 *
 * ## Where this writes
 *
 * `data/demo/demo.db`, never `data/app.db`. Same reasoning as
 * `seed-demo.ts`: the default below plus the runtime assertion in
 * `assertDemoTarget` make the live file unreachable from here by
 * construction, not by remembering to set an env var.
 *
 * Unlike `seed-demo.ts`, this script does NOT drop the database — it is
 * additive on top of whatever spending data already lives there. It is only
 * idempotent for its own rows: every account, snapshot, flow, and
 * transaction it creates hangs off one of the fixed DEMO_ACCOUNT_IDS below,
 * and a rerun deletes exactly those rows before recreating them.
 *
 * Everything below is invented — no real brokerage, account, or amount
 * appears anywhere in it.
 */
import path from 'path';

// Set BEFORE the db client resolves anything — see the comment in
// seed-demo.ts for why this has to be a plain statement here rather than
// something read at call time. `assertDemoTarget` re-checks the resolved
// path at runtime regardless.
process.env.DATABASE_URL ??= 'file:./data/demo/demo.db';

import { getDb, resolveDbFile, schema } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { commitSnapshot, type ParsedHolding } from '@/lib/investments/snapshots';
import { resolveOrCreateSecurity } from '@/lib/investments/securities';
import { eq, inArray } from 'drizzle-orm';

/** Abort unless the resolved database is one this script may write demo rows into. */
function assertDemoTarget(): string {
  const file = resolveDbFile();
  const dir = path.basename(path.dirname(file));
  if (dir !== 'demo') {
    throw new Error(
      `Refusing to seed ${file}.\n` +
        "This script only writes demo investment rows into a file inside a\n" +
        "directory named 'demo' (default: data/demo/demo.db).\n" +
        'Unset DATABASE_URL, or point it at a demo directory.',
    );
  }
  return file;
}

const NOW = new Date().toISOString();

// Fixed ids so reruns are idempotent-ish: the cleanup step below deletes
// every row scoped to these three accounts before recreating them, and never
// touches anything else (including seed-demo.ts's spending accounts).
const PORTFOLIO_ID = 'demo-inv-portfolio-brokerage';
const RESERVE_ID = 'demo-inv-reserve-savings';
const INSURANCE_ID = 'demo-inv-insurance-iul';
const DEMO_ACCOUNT_IDS = [PORTFOLIO_ID, RESERVE_ID, INSURANCE_ID];

// Same Jul 2025 - Jun 2026 window seed-demo.ts uses for spending, so the two
// demo datasets line up on a screenshot or a "last 12 months" chart.
const MONTHS: string[] = [];
for (let i = 6; i < 12; i++) MONTHS.push(`2025-${String(i + 1).padStart(2, '0')}`);
for (let i = 0; i < 6; i++) MONTHS.push(`2026-${String(i + 1).padStart(2, '0')}`);
const asOf = (month: string) => `${month}-28`;

// Gently rising, hand-picked totals rather than a smooth curve: a couple of
// down months keep it from reading as a synthetic straight line. Portfolio
// ends ~$180k, reserve ~$40k, per the brief.
const PORTFOLIO_TOTALS = [
  149500, 152300, 148900, 155200, 159800, 163100,
  161400, 166700, 171200, 174600, 177300, 180900,
];
const RESERVE_TOTALS = [
  32000, 32050, 33580, 33630, 35160, 35210,
  36740, 36090, 37620, 37670, 39200, 40000,
];
const INSURANCE_TOTALS = [
  15000, 15150, 15305, 15465, 15630, 15800,
  15975, 16155, 16340, 16530, 16725, 16925,
];

/** Split `total` across weighted holdings, rounded to the cent. */
function weighted(total: number, weights: number[]): number[] {
  const raw = weights.map((w) => Math.round(total * w * 100) / 100);
  const drift = Math.round((total - raw.reduce((a, b) => a + b, 0)) * 100) / 100;
  raw[raw.length - 1] = Math.round((raw[raw.length - 1] + drift) * 100) / 100;
  return raw;
}

async function seedAccount(
  db: ReturnType<typeof getDb>,
  id: string,
  fields: { name: string; institution: string; owner: string; purpose: string; subtype: string },
) {
  const existing = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
  if (existing) return; // reuse: leave whatever is already there alone.
  db.insert(schema.accounts).values({
    id,
    name: fields.name,
    institution: fields.institution,
    owner: fields.owner,
    accountClass: 'investment',
    purpose: fields.purpose,
    type: 'investment',
    subtype: fields.subtype,
    origin: 'manual',
    status: 'active',
    createdAt: NOW,
    modifiedAt: NOW,
  }).run();
}

/** Delete every row this script owns, scoped to DEMO_ACCOUNT_IDS. Never touches other accounts. */
function cleanup(db: ReturnType<typeof getDb>) {
  const snapIds = db.select({ id: schema.investmentSnapshots.id }).from(schema.investmentSnapshots)
    .where(inArray(schema.investmentSnapshots.accountId, DEMO_ACCOUNT_IDS)).all().map((r) => r.id);
  if (snapIds.length) {
    db.delete(schema.snapshotHoldings).where(inArray(schema.snapshotHoldings.snapshotId, snapIds)).run();
  }
  db.delete(schema.investmentSnapshots).where(inArray(schema.investmentSnapshots.accountId, DEMO_ACCOUNT_IDS)).run();
  db.delete(schema.cashFlows).where(inArray(schema.cashFlows.accountId, DEMO_ACCOUNT_IDS)).run();
  db.delete(schema.investmentTransactions).where(inArray(schema.investmentTransactions.accountId, DEMO_ACCOUNT_IDS)).run();
  db.delete(schema.securityPurposes).where(inArray(schema.securityPurposes.accountId, DEMO_ACCOUNT_IDS)).run();
  // Accounts are intentionally NOT deleted here — seedAccount() reuses them if present.
}

async function main(): Promise<void> {
  const file = assertDemoTarget();
  runMigrations();
  const db = getDb();

  cleanup(db);

  await seedAccount(db, PORTFOLIO_ID, {
    name: 'Brokerage & 401k', institution: 'Vanguard', owner: 'Alex',
    purpose: 'portfolio', subtype: 'brokerage',
  });
  await seedAccount(db, RESERVE_ID, {
    name: 'Emergency Reserve', institution: 'Marcus by Goldman Sachs', owner: 'Joint',
    purpose: 'reserve', subtype: 'money_market',
  });
  await seedAccount(db, INSURANCE_ID, {
    name: 'Indexed Universal Life', institution: 'MassMutual', owner: 'Sam',
    purpose: 'insurance', subtype: 'insurance',
  });

  // Pre-tag the securities with region/cap/style detail so the allocation
  // tree buckets them richly. commitSnapshot() below re-resolves each by
  // ticker/name and reuses these rows rather than overwriting the tags,
  // because its own tagSource ('seed') never outranks an equal precedence.
  await resolveOrCreateSecurity({
    ticker: 'VTI', name: 'Vanguard Total Stock Market ETF',
    kind: 'etf', assetType: 'equity', region: 'us',
  }, db);
  await resolveOrCreateSecurity({
    ticker: 'BND', name: 'Vanguard Total Bond Market ETF',
    kind: 'etf', assetType: 'bond',
  }, db);
  await resolveOrCreateSecurity({
    ticker: 'VXUS', name: 'Vanguard Total International Stock ETF',
    kind: 'etf', assetType: 'equity', region: 'intl_developed',
  }, db);
  await resolveOrCreateSecurity({
    ticker: 'SPAXX', name: 'Fidelity Government Money Market Fund',
    kind: 'mutual_fund', assetType: 'money_market',
  }, db);
  await resolveOrCreateSecurity({
    ticker: null, name: 'IUL Cash Value',
    kind: 'insurance', assetType: 'insurance',
  }, db);

  let snapshotCount = 0;
  let holdingCount = 0;

  for (let i = 0; i < MONTHS.length; i++) {
    const month = MONTHS[i];
    const date = asOf(month);

    const portfolioTotal = PORTFOLIO_TOTALS[i];
    const [vti, bnd, vxus] = weighted(portfolioTotal, [0.6, 0.25, 0.15]);
    const portfolioHoldings: ParsedHolding[] = [
      { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', quantity: null, value: vti, kind: 'etf', assetType: 'equity' },
      { ticker: 'BND', name: 'Vanguard Total Bond Market ETF', quantity: null, value: bnd, kind: 'etf', assetType: 'bond' },
      { ticker: 'VXUS', name: 'Vanguard Total International Stock ETF', quantity: null, value: vxus, kind: 'etf', assetType: 'equity' },
    ];
    await commitSnapshot({
      accountId: PORTFOLIO_ID, asOf: date, source: 'manual',
      totalValue: portfolioTotal, holdings: portfolioHoldings,
    }, db);
    snapshotCount++; holdingCount += portfolioHoldings.length;

    const reserveTotal = RESERVE_TOTALS[i];
    const reserveHoldings: ParsedHolding[] = [
      { ticker: 'SPAXX', name: 'Fidelity Government Money Market Fund', quantity: null, value: reserveTotal, kind: 'mutual_fund', assetType: 'money_market' },
    ];
    await commitSnapshot({
      accountId: RESERVE_ID, asOf: date, source: 'manual',
      totalValue: reserveTotal, holdings: reserveHoldings,
    }, db);
    snapshotCount++; holdingCount += reserveHoldings.length;

    const insuranceTotal = INSURANCE_TOTALS[i];
    const insuranceHoldings: ParsedHolding[] = [
      { ticker: null, name: 'IUL Cash Value', quantity: null, value: insuranceTotal, kind: 'insurance', assetType: 'insurance' },
    ];
    await commitSnapshot({
      accountId: INSURANCE_ID, asOf: date, source: 'manual',
      totalValue: insuranceTotal, holdings: insuranceHoldings,
    }, db);
    snapshotCount++; holdingCount += insuranceHoldings.length;
  }

  // A handful of confirmed reserve contributions/withdrawals, read by
  // listReserveFlows() and query_reserve.
  const reserveFlows: Array<{ date: string; amount: number; kind: string; note: string }> = [
    { date: '2025-09-10', amount: 1500, kind: 'contribution', note: 'Payroll transfer to reserve' },
    { date: '2025-11-10', amount: 1500, kind: 'contribution', note: 'Payroll transfer to reserve' },
    { date: '2026-01-10', amount: 1500, kind: 'contribution', note: 'Payroll transfer to reserve' },
    { date: '2026-02-15', amount: -700, kind: 'withdrawal', note: 'Car repair' },
    { date: '2026-03-10', amount: 1500, kind: 'contribution', note: 'Payroll transfer to reserve' },
    { date: '2026-05-10', amount: 1500, kind: 'contribution', note: 'Payroll transfer to reserve' },
  ];
  for (const f of reserveFlows) {
    db.insert(schema.cashFlows).values({
      id: crypto.randomUUID(),
      accountId: RESERVE_ID,
      securityId: null,
      date: f.date,
      amount: f.amount,
      kind: f.kind,
      source: 'manual',
      confirmed: true,
      note: f.note,
      createdAt: NOW,
      modifiedAt: NOW,
    }).run();
  }

  // A handful of buy/sell/dividend rows for the activity stream and
  // list_investment_transactions.
  const vti = db.select().from(schema.securities).where(eq(schema.securities.ticker, 'VTI')).get()!;
  const bnd = db.select().from(schema.securities).where(eq(schema.securities.ticker, 'BND')).get()!;
  const vxus = db.select().from(schema.securities).where(eq(schema.securities.ticker, 'VXUS')).get()!;

  const investmentTxns: Array<{
    date: string; name: string; amount: number; quantity: number | null; price: number | null;
    type: string; subtype?: string; securityId: string | null;
  }> = [
    { date: '2025-08-05', name: 'Buy VTI', amount: 3025, quantity: 11, price: 275, type: 'buy', securityId: vti.id },
    { date: '2025-09-12', name: 'Buy BND', amount: 1224, quantity: 17, price: 72, type: 'buy', securityId: bnd.id },
    { date: '2025-10-08', name: 'Buy VXUS', amount: 928, quantity: 16, price: 58, type: 'buy', securityId: vxus.id },
    { date: '2025-12-15', name: 'Buy VTI', amount: 3300, quantity: 12, price: 275, type: 'buy', securityId: vti.id },
    { date: '2026-01-20', name: 'VTI Dividend', amount: -410, quantity: null, price: null, type: 'cash', subtype: 'dividend', securityId: vti.id },
    { date: '2026-03-10', name: 'Buy VTI', amount: 4125, quantity: 15, price: 275, type: 'buy', securityId: vti.id },
    { date: '2026-04-10', name: 'Buy BND', amount: 1440, quantity: 20, price: 72, type: 'buy', securityId: bnd.id },
    { date: '2026-06-01', name: 'Sell VXUS', amount: -580, quantity: 10, price: 58, type: 'sell', securityId: vxus.id },
  ];
  for (let i = 0; i < investmentTxns.length; i++) {
    const t = investmentTxns[i];
    db.insert(schema.investmentTransactions).values({
      id: crypto.randomUUID(),
      accountId: PORTFOLIO_ID,
      plaidInvestmentTxnId: `demo-invtxn-${i + 1}`,
      securityId: t.securityId,
      date: t.date,
      name: t.name,
      amount: t.amount,
      quantity: t.quantity,
      price: t.price,
      fees: null,
      type: t.type,
      subtype: t.subtype ?? null,
      createdAt: NOW,
      modifiedAt: NOW,
    }).run();
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seeded demo investments into ${path.relative(process.cwd(), file)}: ` +
    `3 accounts, ${snapshotCount} snapshots, ${holdingCount} holdings, ` +
    `${reserveFlows.length} reserve flows, ${investmentTxns.length} investment transactions.`,
  );
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
