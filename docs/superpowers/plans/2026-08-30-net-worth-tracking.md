# Net Worth Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a balance sheet to Wealthwise — a `/net-worth` page that tracks assets and liabilities the app cannot currently value (real estate, vehicles, HSA, IUL, mortgage, credit cards), carries values forward between readings, and charts net worth over time.

**Architecture:** Every tracked item stays an `accounts` row. A new `balance_snapshots` table stores dated balances as positive magnitudes; direction comes from a pure `netWorthSide()` function at read time. A `netWorth` lib carries the latest snapshot forward per account (reusing the rule `householdValueAt` already established for investments) and unions with `investment_snapshots`. Three phases: manual entry, then Plaid balance auto-fill, then optional third-party property valuation.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind 4 · SQLite via `better-sqlite3` + Drizzle ORM · Chart.js · vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-08-30-net-worth-tracking-design.md`

## Global Constraints

- **TDD is mandatory.** Write the failing test, run it, watch it fail, then implement. This is stated in `app/CLAUDE.md` and is not optional.
- **Never touch the production database.** Tests use `makeTmpDb()` from `@/test/tmpDb`. Before running any migration against `app/data/app.db`, take a snapshot: `snapshotDb('pre-networth')` from `src/lib/backup.ts`.
- **Balances are stored as positive magnitudes, always.** A liability of $8,400 is `8400`, never `-8400`. Sign comes from `netWorthSide()`.
- **A missing snapshot is never a zero.** An account with no snapshot is excluded from a total and named in `missing[]`. It is never summed as 0.
- **Do not change `mapPlaidAccount`.** Credit cards must stay `accountClass: 'spending'` — that classification drives the Home spending charts. `netWorthSide()` exists precisely so this file is not touched.
- **Charts use the app's own tokens.** Import `CHART_PALETTE`, `CHART_DANGER`, `CHART_INK`, `chartDefaults`, `formatCurrency` from `@/lib/chartConfig`. Do not introduce a new palette.
- **IDs are `randomUUID()`** from `node:crypto`, matching `src/lib/accounts.ts`.
- **Dates are `YYYY-MM-DD` strings; months are `YYYY-MM` strings.** Never `Date` objects in the DB.
- **Every mutation route calls `notifyDataChanged()`** on the client after a successful write, per `src/lib/dataEvents.ts`.
- **Commit after every task.** Do not batch.
- Run `npx tsc --noEmit` before each commit. Run `npm test` for unit work, `npm run e2e` only for Task 17.

## File Structure

**New — domain logic (`app/src/lib/netWorth/`)**

| File | Responsibility |
|---|---|
| `side.ts` | `netWorthSide()` — asset / liability / excluded, from an account |
| `catalog.ts` | Static `CatalogItem[]` of common line items and their defaults |
| `read.ts` | `loadNetWorthContext()` — one read of accounts + both snapshot tables |
| `valuation.ts` | `valuationAt()` — carry-forward across both snapshot tables |
| `rollup.ts` | `netWorthAt()`, `netWorthSeries()` |
| `staleness.ts` | `staleAccounts()` |
| `write.ts` | `upsertBalanceSnapshot()`, `createNetWorthAccount()`, `closeAccount()`, `deleteAccount()` |
| `providers/index.ts` | Phase 3: provider registry, returns `null` when unconfigured |
| `providers/rentcast.ts` | Phase 3: RentCast implementation |

**New — API (`app/src/app/api/net-worth/`)**: `route.ts`, `series/route.ts`, `stale/route.ts`, `snapshot/route.ts`, `accounts/route.ts`, `accounts/[id]/route.ts`, `estimate/route.ts` (Phase 3).

**New — UI**: `app/src/app/net-worth/page.tsx` and `app/src/app/components/netWorth/{NetWorthChart,NetWorthWaterfall,StaleStrip,BalanceSheet,AddItemSheet}.tsx`.

**Modified**: `src/db/schema.ts`, `src/app/components/AppHeader.tsx` (NAV), `src/lib/plaid/sync.ts` (Phase 2), `src/lib/agent/tools/read.ts`, `README.md` + `.env.example` (Phase 3).

---

## Phase 1 — Manual model, rollup, and page

### Task 1: Schema and migration

**Files:**
- Modify: `app/src/db/schema.ts`
- Test: `app/src/lib/netWorth/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `balanceSnapshots` table export; `accounts.reviewIntervalMonths` (`integer | null`), `accounts.securedByAccountId` (`text | null`); `accountClass` may now be `'asset'`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/netWorth/__tests__/schema.test.ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, balanceSnapshots } from '@/db/schema';
import { eq } from 'drizzle-orm';

const NOW = '2026-08-30T00:00:00.000Z';

function makeAccount(db: ReturnType<typeof makeTmpDb>['db'], over: Partial<typeof accounts.$inferInsert> = {}) {
  const id = randomUUID();
  db.insert(accounts).values({
    id, name: 'Home', institution: 'Manual', owner: '',
    accountClass: 'asset', purpose: 'portfolio', type: 'property',
    subtype: 'real_estate', origin: 'manual', status: 'active',
    createdAt: NOW, modifiedAt: NOW, ...over,
  }).run();
  return id;
}

describe('balance_snapshots schema', () => {
  it('stores a dated balance for an asset-class account', () => {
    const { db } = makeTmpDb();
    const accountId = makeAccount(db);
    db.insert(balanceSnapshots).values({
      id: randomUUID(), accountId, asOf: '2026-08-01', month: '2026-08',
      balance: 1150000, source: 'manual', note: '', createdAt: NOW, modifiedAt: NOW,
    }).run();
    const rows = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, accountId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].balance).toBe(1150000);
  });

  it('rejects a second snapshot for the same account and date', () => {
    const { db } = makeTmpDb();
    const accountId = makeAccount(db);
    const row = {
      accountId, asOf: '2026-08-01', month: '2026-08',
      balance: 100, source: 'manual' as const, note: '', createdAt: NOW, modifiedAt: NOW,
    };
    db.insert(balanceSnapshots).values({ id: randomUUID(), ...row }).run();
    expect(() => db.insert(balanceSnapshots).values({ id: randomUUID(), ...row }).run()).toThrow();
  });

  it('accepts reviewIntervalMonths and securedByAccountId on accounts', () => {
    const { db } = makeTmpDb();
    const houseId = makeAccount(db);
    const loanId = makeAccount(db, {
      name: 'Mortgage', accountClass: 'liability', subtype: 'mortgage',
      securedByAccountId: houseId, reviewIntervalMonths: null,
    });
    db.update(accounts).set({ reviewIntervalMonths: 12 }).where(eq(accounts.id, houseId)).run();
    const house = db.select().from(accounts).where(eq(accounts.id, houseId)).get();
    const loan = db.select().from(accounts).where(eq(accounts.id, loanId)).get();
    expect(house?.reviewIntervalMonths).toBe(12);
    expect(loan?.securedByAccountId).toBe(houseId);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/schema.test.ts`
Expected: FAIL — `balanceSnapshots` is not exported from `@/db/schema`.

- [ ] **Step 3: Add the table and columns to the schema**

Append to `app/src/db/schema.ts`:

```ts
export const balanceSnapshots = sqliteTable('balance_snapshots', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  asOf: text('as_of').notNull(),                 // YYYY-MM-DD
  month: text('month').notNull(),                // YYYY-MM
  // ALWAYS a positive magnitude. A liability of $8,400 is 8400, never -8400:
  // that is how the statement reads, and a sign-flip bug in a rollup is silent.
  // Direction comes from netWorthSide(account) at read time.
  balance: real('balance').notNull().default(0),
  source: text('source').notNull().default('manual'), // plaid | manual | statement | estimate
  note: text('note').notNull().default(''),
  createdAt: text('created_at').notNull(),
  modifiedAt: text('modified_at').notNull(),
}, (t) => ({
  uniq: unique('balsnap_account_asof').on(t.accountId, t.asOf),
  byMonth: index('balsnap_month').on(t.month),
}));
```

In the existing `accounts` table definition, add two columns and widen the `accountClass` comment:

```ts
  accountClass: text('account_class').notNull().default('spending'), // spending | investment | liability | asset
  // Expected refresh cadence for a manually-valued item. NULL = never nag,
  // which is correct for every Plaid-fed account.
  reviewIntervalMonths: integer('review_interval_months'),
  // A liability may point at the asset securing it: mortgage -> house,
  // auto loan -> car. NULL for a credit card.
  securedByAccountId: text('secured_by_account_id'),
  // Phase 3. NULL means manual, which is the default for every account.
  valuationProvider: text('valuation_provider'),
  // The provider's lookup key — for RentCast, the property address.
  valuationRef: text('valuation_ref'),
```

Also add the AVM range columns to `balanceSnapshots`, so the write path has one
shape across all three phases (an estimate carries bounds; a typed value does not):

```ts
  valueLow: real('value_low'),
  valueHigh: real('value_high'),
```

**Every schema change for all three phases lands here, in one migration.**
Tasks 7 and 17 deliberately do not touch `schema.ts`.

- [ ] **Step 4: Generate the migration and hand-check it**

Run: `cd app && npm run db:generate`

Open the newly generated file in `app/src/db/migrations/`. Verify it contains `CREATE TABLE balance_snapshots`, `ALTER TABLE accounts ADD ...` for both columns, and — critically — that it does **not** drop or recreate the `accounts_owner_institution_name_mask` index. `schema.ts` documents that this index is hand-edited SQL that drizzle-kit cannot express; if the generated migration touches it, delete those statements before proceeding.

- [ ] **Step 5: Run the test and verify it passes**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/schema.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
cd app && npx tsc --noEmit
git add src/db/schema.ts src/db/migrations src/lib/netWorth/__tests__/schema.test.ts
git commit -m "feat(net-worth): add balance_snapshots table and account valuation columns"
```

---

### Task 2: Sign derivation

**Files:**
- Create: `app/src/lib/netWorth/side.ts`
- Test: `app/src/lib/netWorth/__tests__/side.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Side = 'asset' | 'liability' | 'excluded'` and `netWorthSide(a: SideInput): Side`, where `SideInput = Pick<AccountRow, 'accountClass' | 'type'>`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/netWorth/__tests__/side.test.ts
import { describe, it, expect } from 'vitest';
import { netWorthSide } from '@/lib/netWorth/side';

describe('netWorthSide', () => {
  it('treats an explicit liability account as a liability', () => {
    expect(netWorthSide({ accountClass: 'liability', type: 'loan' })).toBe('liability');
  });

  // The load-bearing case: Plaid maps credit cards to accountClass 'spending'
  // because that classification drives the Home spending charts. This function
  // exists so mapAccount.ts never has to change.
  it('treats a Plaid credit card as a liability despite its spending class', () => {
    expect(netWorthSide({ accountClass: 'spending', type: 'credit' })).toBe('liability');
  });

  it('treats checking and savings as assets', () => {
    expect(netWorthSide({ accountClass: 'spending', type: 'depository' })).toBe('asset');
  });

  it('treats investment and asset classes as assets', () => {
    expect(netWorthSide({ accountClass: 'investment', type: 'investment' })).toBe('asset');
    expect(netWorthSide({ accountClass: 'asset', type: 'property' })).toBe('asset');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/side.test.ts`
Expected: FAIL — cannot resolve `@/lib/netWorth/side`.

- [ ] **Step 3: Write the implementation**

```ts
// app/src/lib/netWorth/side.ts
import type { AccountRow } from '@/lib/accounts';

export type Side = 'asset' | 'liability' | 'excluded';

export type SideInput = Pick<AccountRow, 'accountClass' | 'type'>;

/**
 * Which side of the balance sheet an account sits on.
 *
 * Deliberately derived rather than stored. Plaid maps credit cards to
 * accountClass 'spending' (mapAccount.ts), and that classification is what the
 * Home spending charts filter on — so reclassifying cards to 'liability' to make
 * net worth easier would silently change what counts as spending. Rule 2 below
 * is the whole reason this function exists.
 */
export function netWorthSide(a: SideInput): Side {
  if (a.accountClass === 'liability') return 'liability';
  if (a.accountClass === 'spending' && a.type === 'credit') return 'liability';
  if (a.accountClass === 'spending') return 'asset';
  if (a.accountClass === 'investment' || a.accountClass === 'asset') return 'asset';
  return 'excluded';
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/side.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd app && npx tsc --noEmit
git add src/lib/netWorth/side.ts src/lib/netWorth/__tests__/side.test.ts
git commit -m "feat(net-worth): derive balance-sheet side from account class and type"
```

---
### Task 3: Item catalog

**Files:**
- Create: `app/src/lib/netWorth/catalog.ts`
- Test: `app/src/lib/netWorth/__tests__/catalog.test.ts`

**Interfaces:**
- Consumes: `Side` from `@/lib/netWorth/side`.
- Produces: `interface CatalogItem`, `CATALOG: CatalogItem[]`, `catalogByKey(key: string): CatalogItem | undefined`, `ASSET_GROUPS: readonly string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/netWorth/__tests__/catalog.test.ts
import { describe, it, expect } from 'vitest';
import { CATALOG, catalogByKey, groupForSubtype, ASSET_GROUPS } from '@/lib/netWorth/catalog';

describe('catalog', () => {
  it('has unique keys', () => {
    const keys = CATALOG.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every liability a null review interval', () => {
    // A loan balance is not an estimate — it is synced or read off a statement,
    // so it must never appear in the stale list.
    for (const item of CATALOG.filter((c) => c.side === 'liability')) {
      expect(item.reviewIntervalMonths).toBeNull();
    }
  });

  it('points every securedByGroup at a group that exists on the asset side', () => {
    for (const item of CATALOG.filter((c) => c.securedByGroup)) {
      expect(ASSET_GROUPS).toContain(item.securedByGroup);
    }
  });

  it('gives every asset-side item a valid account class', () => {
    const valid = ['asset', 'investment', 'spending'];
    for (const item of CATALOG.filter((c) => c.side === 'asset')) {
      expect(valid).toContain(item.accountClass);
    }
  });

  it('carries the hints that prevent wrong numbers', () => {
    expect(catalogByKey('life_insurance_cash_value')?.hint).toMatch(/cash surrender value/i);
    expect(catalogByKey('pension')?.hint).toMatch(/lump-sum|present-value/i);
    expect(catalogByKey('traditional_ira')?.hint).toMatch(/deferred|tax/i);
  });

  it('offers a mortgage secured by property and an auto loan secured by vehicles', () => {
    expect(catalogByKey('mortgage')?.securedByGroup).toBe('property');
    expect(catalogByKey('auto_loan')?.securedByGroup).toBe('vehicles');
  });

  it('maps a stored subtype back to its display group', () => {
    expect(groupForSubtype('real_estate')).toBe('property');
    expect(groupForSubtype('vehicle')).toBe('vehicles');
    expect(groupForSubtype('mortgage')).toBe('debt');
    // A subtype from a Plaid account that predates the catalog still resolves.
    expect(groupForSubtype('credit card')).toBe('debt');
    expect(groupForSubtype('nonsense')).toBe('other');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/catalog.test.ts`
Expected: FAIL — cannot resolve `@/lib/netWorth/catalog`.

- [ ] **Step 3: Write the implementation**

```ts
// app/src/lib/netWorth/catalog.ts
import type { Side } from '@/lib/netWorth/side';

export type CatalogGroup = 'cash' | 'investments' | 'property' | 'vehicles' | 'other' | 'debt';

export const ASSET_GROUPS = ['cash', 'investments', 'property', 'vehicles', 'other'] as const;

export interface CatalogItem {
  key: string;
  label: string;
  group: CatalogGroup;
  side: Side;
  accountClass: 'asset' | 'investment' | 'spending' | 'liability';
  subtype: string;
  /** Expected refresh cadence in months. NULL = never nag. */
  reviewIntervalMonths: number | null;
  /** Liabilities only: which asset group the "Secured by" dropdown lists. */
  securedByGroup?: 'property' | 'vehicles' | 'other';
  /** Shown under the value field. Present only where the obvious value is wrong. */
  hint?: string;
}

const asset = (
  key: string, label: string, group: CatalogGroup,
  accountClass: CatalogItem['accountClass'], subtype: string,
  reviewIntervalMonths: number | null, hint?: string,
): CatalogItem => ({ key, label, group, side: 'asset', accountClass, subtype, reviewIntervalMonths, hint });

const debt = (
  key: string, label: string, subtype: string,
  securedByGroup?: CatalogItem['securedByGroup'],
): CatalogItem => ({
  key, label, group: 'debt', side: 'liability', accountClass: 'liability',
  subtype, reviewIntervalMonths: null, securedByGroup,
});

export const CATALOG: CatalogItem[] = [
  asset('checking', 'Checking', 'cash', 'spending', 'checking', 1),
  asset('savings', 'Savings', 'cash', 'spending', 'savings', 1),
  asset('cd', 'Certificate of deposit', 'cash', 'spending', 'cd', 3),
  asset('money_market', 'Money market', 'cash', 'spending', 'money_market', 1),
  asset('cash_on_hand', 'Cash on hand', 'cash', 'spending', 'cash', 3),

  asset('brokerage', 'Brokerage', 'investments', 'investment', 'brokerage', 3),
  asset('workplace_retirement', '401(k) / 403(b)', 'investments', 'investment', '401k', 3,
    'Counted at full balance; deferred income tax is not modeled.'),
  asset('traditional_ira', 'Traditional IRA', 'investments', 'investment', 'ira', 3,
    'Counted at full balance; deferred income tax is not modeled.'),
  asset('roth_ira', 'Roth IRA', 'investments', 'investment', 'roth', 3),
  asset('hsa', 'HSA', 'investments', 'investment', 'hsa', 3),
  asset('five_two_nine', '529 college savings', 'investments', 'investment', '529', 3),
  asset('crypto', 'Crypto', 'investments', 'investment', 'crypto', 1),
  asset('pension', 'Pension', 'investments', 'investment', 'pension', 12,
    'Only include this if your plan reports a lump-sum or present-value figure.'),

  asset('primary_residence', 'Primary residence', 'property', 'asset', 'real_estate', 12),
  asset('rental_property', 'Rental property', 'property', 'asset', 'real_estate', 12),
  asset('land', 'Land', 'property', 'asset', 'real_estate', 12),

  asset('car', 'Car', 'vehicles', 'asset', 'vehicle', 12),
  asset('motorcycle', 'Motorcycle', 'vehicles', 'asset', 'vehicle', 12),
  asset('boat', 'Boat', 'vehicles', 'asset', 'vehicle', 12),
  asset('rv', 'RV', 'vehicles', 'asset', 'vehicle', 12),

  asset('life_insurance_cash_value', 'Life insurance cash value', 'other', 'investment', 'insurance', 12,
    'Enter the cash surrender value, not the death benefit.'),
  asset('business_equity', 'Business equity', 'other', 'asset', 'business', 12),
  asset('collectibles', 'Collectibles, art, jewelry', 'other', 'asset', 'collectible', 12),
  asset('other_asset', 'Other asset', 'other', 'asset', 'other', 12),

  debt('mortgage', 'Mortgage', 'mortgage', 'property'),
  debt('heloc', 'HELOC', 'heloc', 'property'),
  debt('auto_loan', 'Auto loan', 'auto', 'vehicles'),
  debt('student_loan', 'Student loan', 'student'),
  debt('credit_card', 'Credit card', 'credit'),
  debt('personal_loan', 'Personal loan', 'personal'),
  debt('retirement_loan', '401(k) loan', 'retirement_loan'),
  debt('policy_loan', 'Policy loan', 'policy_loan', 'other'),
  debt('medical_debt', 'Medical debt', 'medical'),
  debt('taxes_owed', 'Taxes owed', 'tax'),
  debt('other_liability', 'Other liability', 'other'),
];

export function catalogByKey(key: string): CatalogItem | undefined {
  return CATALOG.find((c) => c.key === key);
}

/**
 * Display group for a stored account subtype.
 *
 * Accounts created before this catalog existed (every Plaid row) carry subtypes
 * the catalog never issued, so this must always return something. Anything with
 * 'credit' or 'loan' in it is debt; anything else unrecognised falls to 'other'.
 */
export function groupForSubtype(subtype: string): CatalogGroup {
  const exact = CATALOG.find((c) => c.subtype === subtype);
  if (exact) return exact.group;
  const s = subtype.toLowerCase();
  if (s.includes('credit') || s.includes('loan') || s.includes('mortgage')) return 'debt';
  if (s.includes('checking') || s.includes('savings') || s.includes('depository')) return 'cash';
  return 'other';
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/catalog.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd app && npx tsc --noEmit
git add src/lib/netWorth/catalog.ts src/lib/netWorth/__tests__/catalog.test.ts
git commit -m "feat(net-worth): add catalog of common balance-sheet line items"
```

---

### Task 4: Context loading and carry-forward valuation

**Files:**
- Create: `app/src/lib/netWorth/read.ts`, `app/src/lib/netWorth/valuation.ts`
- Test: `app/src/lib/netWorth/__tests__/valuation.test.ts`

**Interfaces:**
- Consumes: `balanceSnapshots`, `accounts`, `investmentSnapshots` from `@/db/schema`; `AccountRow` from `@/lib/accounts`.
- Produces:
  - `interface NetWorthContext { accounts: AccountRow[]; balances: Reading[]; investments: Reading[] }`
  - `interface Reading { accountId: string; asOf: string; value: number; source: string }`
  - `loadNetWorthContext(db?: Db): Promise<NetWorthContext>`
  - `valuationAt(ctx: NetWorthContext, accountId: string, date: string): number | null`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/netWorth/__tests__/valuation.test.ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, balanceSnapshots, investmentSnapshots } from '@/db/schema';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { valuationAt } from '@/lib/netWorth/valuation';

const NOW = '2026-08-30T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function addAccount(db: Db, over: Partial<typeof accounts.$inferInsert> = {}): string {
  const id = randomUUID();
  db.insert(accounts).values({
    id, name: 'Home', institution: 'Manual', owner: '', accountClass: 'asset',
    purpose: 'portfolio', type: 'property', subtype: 'real_estate', origin: 'manual',
    status: 'active', createdAt: NOW, modifiedAt: NOW, ...over,
  }).run();
  return id;
}

function addBalance(db: Db, accountId: string, asOf: string, balance: number) {
  db.insert(balanceSnapshots).values({
    id: randomUUID(), accountId, asOf, month: asOf.slice(0, 7),
    balance, source: 'manual', note: '', createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('valuationAt', () => {
  it('carries the latest reading forward across a gap', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db);
    addBalance(db, id, '2026-02-01', 1_100_000);
    addBalance(db, id, '2026-08-01', 1_150_000);
    const ctx = await loadNetWorthContext(db);
    expect(valuationAt(ctx, id, '2026-05-15')).toBe(1_100_000);
    expect(valuationAt(ctx, id, '2026-08-30')).toBe(1_150_000);
  });

  it('returns null before the first reading, never zero', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db);
    addBalance(db, id, '2026-02-01', 1_100_000);
    const ctx = await loadNetWorthContext(db);
    expect(valuationAt(ctx, id, '2026-01-01')).toBeNull();
  });

  it('returns null for an account with no reading at all', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { name: 'Second car' });
    const ctx = await loadNetWorthContext(db);
    expect(valuationAt(ctx, id, '2026-08-30')).toBeNull();
  });

  it('reads an investment-class account from investment_snapshots', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { name: 'IUL', accountClass: 'investment', purpose: 'insurance', subtype: 'insurance' });
    db.insert(investmentSnapshots).values({
      id: randomUUID(), accountId: id, asOf: '2026-06-01', month: '2026-06',
      source: 'manual', totalValue: 68_000, holdingsComplete: false, note: '',
      createdAt: NOW, modifiedAt: NOW,
    }).run();
    const ctx = await loadNetWorthContext(db);
    expect(valuationAt(ctx, id, '2026-08-30')).toBe(68_000);
  });

  it('falls back to the other table when the class-preferred one is empty', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { name: 'HSA', accountClass: 'investment', subtype: 'hsa' });
    addBalance(db, id, '2026-07-01', 42_000);
    const ctx = await loadNetWorthContext(db);
    expect(valuationAt(ctx, id, '2026-08-30')).toBe(42_000);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/valuation.test.ts`
Expected: FAIL — cannot resolve `@/lib/netWorth/read`.

- [ ] **Step 3: Write `read.ts`**

```ts
// app/src/lib/netWorth/read.ts
import { getDb } from '@/db/client';
import { accounts, balanceSnapshots, investmentSnapshots } from '@/db/schema';
import type { AccountRow } from '@/lib/accounts';

type Db = ReturnType<typeof getDb>;

export interface Reading {
  accountId: string;
  asOf: string;
  value: number;
  source: string;
}

export interface NetWorthContext {
  accounts: AccountRow[];
  /** Ascending by asOf, so a carry-forward scan can stop at the first row past the date. */
  balances: Reading[];
  investments: Reading[];
}

/**
 * One read of everything the rollup needs. Loaded once per request and passed
 * down, mirroring loadAllocationContext in the investments lib — the alternative
 * is a query per account per period, which is quadratic on the trend chart.
 */
export async function loadNetWorthContext(db: Db = getDb()): Promise<NetWorthContext> {
  const accountRows = db.select().from(accounts).all() as AccountRow[];
  const balanceRows = db.select().from(balanceSnapshots).all();
  const investmentRows = db.select().from(investmentSnapshots).all();

  const byAsOf = (a: Reading, b: Reading) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0);

  return {
    accounts: accountRows,
    balances: balanceRows
      .map((r) => ({ accountId: r.accountId, asOf: r.asOf, value: r.balance, source: r.source }))
      .sort(byAsOf),
    investments: investmentRows
      .map((r) => ({ accountId: r.accountId, asOf: r.asOf, value: r.totalValue, source: r.source }))
      .sort(byAsOf),
  };
}
```

- [ ] **Step 4: Write `valuation.ts`**

```ts
// app/src/lib/netWorth/valuation.ts
import type { NetWorthContext, Reading } from '@/lib/netWorth/read';

function latestAtOrBefore(readings: Reading[], accountId: string, date: string): number | null {
  let best: Reading | null = null;
  for (const r of readings) {
    if (r.accountId !== accountId) continue;
    if (r.asOf > date) continue;
    if (best === null || r.asOf > best.asOf) best = r;
  }
  return best ? best.value : null;
}

/**
 * An account's value on `date`, carried forward from its most recent reading.
 *
 * This is the same rule householdValueAt already uses for investments: the
 * newest snapshot at or before the date stands until a newer one replaces it.
 * A house valued in February is worth February's number in May — that is an
 * assumption, and staleAccounts() is what makes it visible rather than silent.
 *
 * Returns null — never 0 — when the account has no reading at or before the
 * date. Callers must exclude a null and report it, because a missing reading
 * is not an empty account.
 *
 * Investment-class accounts prefer investment_snapshots (authoritative, and the
 * only table carrying holdings); everything else prefers balance_snapshots. Each
 * falls back to the other so a manually-entered HSA works either way.
 */
export function valuationAt(ctx: NetWorthContext, accountId: string, date: string): number | null {
  const account = ctx.accounts.find((a) => a.id === accountId);
  const preferInvestments = account?.accountClass === 'investment';
  const first = preferInvestments ? ctx.investments : ctx.balances;
  const second = preferInvestments ? ctx.balances : ctx.investments;
  const primary = latestAtOrBefore(first, accountId, date);
  return primary !== null ? primary : latestAtOrBefore(second, accountId, date);
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/valuation.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
cd app && npx tsc --noEmit
git add src/lib/netWorth/read.ts src/lib/netWorth/valuation.ts src/lib/netWorth/__tests__/valuation.test.ts
git commit -m "feat(net-worth): load balance-sheet context and carry valuations forward"
```

---
### Task 5: Rollup — `netWorthAt` and `netWorthSeries`

**Files:**
- Create: `app/src/lib/netWorth/rollup.ts`
- Test: `app/src/lib/netWorth/__tests__/rollup.test.ts`

**Interfaces:**
- Consumes: `NetWorthContext` and `loadNetWorthContext` from `read.ts`, `valuationAt` from `valuation.ts`, `netWorthSide` from `side.ts`, `enumerateAllocationPeriods` and `AllocationBasis` from `@/lib/investments/periods`.
- Produces:
  - `interface NetWorthTotals { assetsLiquid: number; assetsIlliquid: number; assets: number; liabilities: number; net: number; missing: string[] }`
  - `netWorthAt(ctx: NetWorthContext, date: string): NetWorthTotals`
  - `interface SeriesPoint extends NetWorthTotals { key: string; label: string; date: string }`
  - `netWorthSeries(ctx: NetWorthContext, from: string, to: string, basis: AllocationBasis): SeriesPoint[]`

Liquid means `accountClass` of `spending` or `investment`; illiquid means `asset`. That split is what the trend chart stacks.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/netWorth/__tests__/rollup.test.ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, balanceSnapshots } from '@/db/schema';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { netWorthAt, netWorthSeries } from '@/lib/netWorth/rollup';

const NOW = '2026-08-30T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function addAccount(db: Db, over: Partial<typeof accounts.$inferInsert> = {}): string {
  const id = randomUUID();
  db.insert(accounts).values({
    id, name: 'Item', institution: 'Manual', owner: '', accountClass: 'asset',
    purpose: 'portfolio', type: 'property', subtype: 'real_estate', origin: 'manual',
    status: 'active', createdAt: NOW, modifiedAt: NOW, ...over,
  }).run();
  return id;
}

function addBalance(db: Db, accountId: string, asOf: string, balance: number) {
  db.insert(balanceSnapshots).values({
    id: randomUUID(), accountId, asOf, month: asOf.slice(0, 7),
    balance, source: 'manual', note: '', createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('netWorthAt', () => {
  it('subtracts liabilities from assets using derived signs', async () => {
    const { db } = makeTmpDb();
    const house = addAccount(db, { name: 'Home' });
    const mortgage = addAccount(db, { name: 'Mortgage', accountClass: 'liability', type: 'loan', subtype: 'mortgage' });
    addBalance(db, house, '2026-08-01', 1_150_000);
    addBalance(db, mortgage, '2026-08-01', 620_000);
    const totals = netWorthAt(await loadNetWorthContext(db), '2026-08-30');
    expect(totals.assets).toBe(1_150_000);
    expect(totals.liabilities).toBe(620_000);
    expect(totals.net).toBe(530_000);
  });

  it('treats a Plaid credit card balance as a liability', async () => {
    const { db } = makeTmpDb();
    const card = addAccount(db, { name: 'Card', accountClass: 'spending', type: 'credit', subtype: 'credit card' });
    addBalance(db, card, '2026-08-01', 8_400);
    const totals = netWorthAt(await loadNetWorthContext(db), '2026-08-30');
    expect(totals.liabilities).toBe(8_400);
    expect(totals.net).toBe(-8_400);
  });

  it('excludes a never-valued account and names it in missing, never summing it as zero', async () => {
    const { db } = makeTmpDb();
    const house = addAccount(db, { name: 'Home' });
    addAccount(db, { name: 'Second car', subtype: 'vehicle' });
    addBalance(db, house, '2026-08-01', 1_150_000);
    const totals = netWorthAt(await loadNetWorthContext(db), '2026-08-30');
    expect(totals.net).toBe(1_150_000);
    expect(totals.missing).toEqual(['Second car']);
  });

  it('splits assets into liquid and illiquid', async () => {
    const { db } = makeTmpDb();
    const checking = addAccount(db, { name: 'Checking', accountClass: 'spending', type: 'depository', subtype: 'checking' });
    const house = addAccount(db, { name: 'Home' });
    addBalance(db, checking, '2026-08-01', 85_000);
    addBalance(db, house, '2026-08-01', 1_150_000);
    const totals = netWorthAt(await loadNetWorthContext(db), '2026-08-30');
    expect(totals.assetsLiquid).toBe(85_000);
    expect(totals.assetsIlliquid).toBe(1_150_000);
  });

  // The sold-car regression guard. Closing must not rewrite history.
  it('drops a closed account after its closing month but keeps it before', async () => {
    const { db } = makeTmpDb();
    const car = addAccount(db, { name: 'Car', subtype: 'vehicle', status: 'closed', closedAtMonth: '2026-06' });
    addBalance(db, car, '2026-01-01', 30_000);
    const ctx = await loadNetWorthContext(db);
    expect(netWorthAt(ctx, '2026-03-31').net).toBe(30_000);
    expect(netWorthAt(ctx, '2026-06-30').net).toBe(30_000);
    expect(netWorthAt(ctx, '2026-07-31').net).toBe(0);
    expect(netWorthAt(ctx, '2026-07-31').missing).toEqual([]);
  });
});

describe('netWorthSeries', () => {
  it('holds flat across a month with no new reading', async () => {
    const { db } = makeTmpDb();
    const house = addAccount(db, { name: 'Home' });
    addBalance(db, house, '2026-05-01', 1_100_000);
    addBalance(db, house, '2026-08-01', 1_150_000);
    const points = netWorthSeries(await loadNetWorthContext(db), '2026-05-01', '2026-08-31', 'monthly');
    expect(points.map((p) => p.net)).toEqual([1_100_000, 1_100_000, 1_100_000, 1_150_000]);
    expect(points[0].label).toContain('May');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/rollup.test.ts`
Expected: FAIL — cannot resolve `@/lib/netWorth/rollup`.

- [ ] **Step 3: Write the implementation**

```ts
// app/src/lib/netWorth/rollup.ts
import type { NetWorthContext } from '@/lib/netWorth/read';
import { valuationAt } from '@/lib/netWorth/valuation';
import { netWorthSide } from '@/lib/netWorth/side';
import { enumerateAllocationPeriods, type AllocationBasis } from '@/lib/investments/periods';
import type { AccountRow } from '@/lib/accounts';

export interface NetWorthTotals {
  assetsLiquid: number;
  assetsIlliquid: number;
  assets: number;
  liabilities: number;
  net: number;
  /** Names of accounts with no reading at or before the date. Never summed as 0. */
  missing: string[];
}

export interface SeriesPoint extends NetWorthTotals {
  key: string;
  label: string;
  date: string;
}

/**
 * An account still counts through the end of the month it was closed in, and
 * not after. Without this, carry-forward would keep a sold car on the books
 * forever — but zeroing it retroactively would rewrite the trend, which is why
 * closing is a status change rather than a delete.
 */
function isCountable(a: AccountRow, date: string): boolean {
  if (a.status !== 'closed') return true;
  if (!a.closedAtMonth) return false;
  return date.slice(0, 7) <= a.closedAtMonth;
}

export function netWorthAt(ctx: NetWorthContext, date: string): NetWorthTotals {
  let assetsLiquid = 0, assetsIlliquid = 0, liabilities = 0;
  const missing: string[] = [];

  for (const account of ctx.accounts) {
    const side = netWorthSide(account);
    if (side === 'excluded') continue;
    if (!isCountable(account, date)) continue;

    const value = valuationAt(ctx, account.id, date);
    if (value === null) {
      // Never a zero. The caller surfaces this list so the total's incompleteness
      // is stated rather than silently absorbed.
      missing.push(account.name);
      continue;
    }

    if (side === 'liability') liabilities += value;
    else if (account.accountClass === 'asset') assetsIlliquid += value;
    else assetsLiquid += value;
  }

  const assets = assetsLiquid + assetsIlliquid;
  return { assetsLiquid, assetsIlliquid, assets, liabilities, net: assets - liabilities, missing };
}

export function netWorthSeries(
  ctx: NetWorthContext, from: string, to: string, basis: AllocationBasis,
): SeriesPoint[] {
  return enumerateAllocationPeriods(from, to, basis).map((p) => ({
    key: p.key, label: p.label, date: p.endDate, ...netWorthAt(ctx, p.endDate),
  }));
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/rollup.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
cd app && npx tsc --noEmit
git add src/lib/netWorth/rollup.ts src/lib/netWorth/__tests__/rollup.test.ts
git commit -m "feat(net-worth): roll assets and liabilities into a dated net worth total"
```

---

### Task 6: Staleness

**Files:**
- Create: `app/src/lib/netWorth/staleness.ts`
- Test: `app/src/lib/netWorth/__tests__/staleness.test.ts`

**Interfaces:**
- Consumes: `NetWorthContext` from `read.ts`.
- Produces: `interface StaleAccount { accountId: string; name: string; lastAsOf: string | null; monthsOverdue: number }` and `staleAccounts(ctx: NetWorthContext, asOf: string): StaleAccount[]`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/netWorth/__tests__/staleness.test.ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, balanceSnapshots } from '@/db/schema';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { staleAccounts } from '@/lib/netWorth/staleness';

const NOW = '2026-08-30T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function addAccount(db: Db, over: Partial<typeof accounts.$inferInsert> = {}): string {
  const id = randomUUID();
  db.insert(accounts).values({
    id, name: 'Home', institution: 'Manual', owner: '', accountClass: 'asset',
    purpose: 'portfolio', type: 'property', subtype: 'real_estate', origin: 'manual',
    status: 'active', reviewIntervalMonths: 12, createdAt: NOW, modifiedAt: NOW, ...over,
  }).run();
  return id;
}

function addBalance(db: Db, accountId: string, asOf: string, balance: number) {
  db.insert(balanceSnapshots).values({
    id: randomUUID(), accountId, asOf, month: asOf.slice(0, 7),
    balance, source: 'manual', note: '', createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('staleAccounts', () => {
  it('reports an account past its review interval', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { reviewIntervalMonths: 6 });
    addBalance(db, id, '2026-01-01', 1_100_000);
    const stale = staleAccounts(await loadNetWorthContext(db), '2026-08-30');
    expect(stale).toHaveLength(1);
    expect(stale[0].monthsOverdue).toBe(1);
    expect(stale[0].lastAsOf).toBe('2026-01-01');
  });

  it('does not report an account exactly at its interval', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { reviewIntervalMonths: 6 });
    addBalance(db, id, '2026-02-28', 1_100_000);
    expect(staleAccounts(await loadNetWorthContext(db), '2026-08-30')).toEqual([]);
  });

  it('never reports an account with a null interval', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { name: 'Checking', reviewIntervalMonths: null });
    addBalance(db, id, '2020-01-01', 85_000);
    expect(staleAccounts(await loadNetWorthContext(db), '2026-08-30')).toEqual([]);
  });

  it('reports a never-valued account with a null lastAsOf', async () => {
    const { db } = makeTmpDb();
    addAccount(db, { name: 'Second car', reviewIntervalMonths: 12 });
    const stale = staleAccounts(await loadNetWorthContext(db), '2026-08-30');
    expect(stale[0].lastAsOf).toBeNull();
  });

  it('ignores closed accounts', async () => {
    const { db } = makeTmpDb();
    const id = addAccount(db, { name: 'Old car', status: 'closed', closedAtMonth: '2026-06' });
    addBalance(db, id, '2020-01-01', 30_000);
    expect(staleAccounts(await loadNetWorthContext(db), '2026-08-30')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/staleness.test.ts`
Expected: FAIL — cannot resolve `@/lib/netWorth/staleness`.

- [ ] **Step 3: Write the implementation**

```ts
// app/src/lib/netWorth/staleness.ts
import type { NetWorthContext } from '@/lib/netWorth/read';

export interface StaleAccount {
  accountId: string;
  name: string;
  /** null when the account has never been valued at all. */
  lastAsOf: string | null;
  monthsOverdue: number;
}

/** Whole months between two YYYY-MM-DD dates, by calendar month and day-of-month. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}

/**
 * Accounts whose newest reading is older than their expected refresh cadence.
 *
 * A null reviewIntervalMonths means "never nag" and is correct for anything
 * Plaid feeds — a synced balance is not an estimate going stale. Closed accounts
 * are skipped: you are not asked to re-value a car you sold.
 */
export function staleAccounts(ctx: NetWorthContext, asOf: string): StaleAccount[] {
  const out: StaleAccount[] = [];

  for (const account of ctx.accounts) {
    const interval = account.reviewIntervalMonths;
    if (interval === null || interval === undefined) continue;
    if (account.status === 'closed') continue;

    const readings = [...ctx.balances, ...ctx.investments]
      .filter((r) => r.accountId === account.id && r.asOf <= asOf)
      .sort((a, b) => (a.asOf < b.asOf ? 1 : -1));
    const lastAsOf = readings[0]?.asOf ?? null;

    if (lastAsOf === null) {
      out.push({ accountId: account.id, name: account.name, lastAsOf: null, monthsOverdue: interval });
      continue;
    }
    const age = monthsBetween(lastAsOf, asOf);
    if (age > interval) {
      out.push({ accountId: account.id, name: account.name, lastAsOf, monthsOverdue: age - interval });
    }
  }

  return out.sort((a, b) => b.monthsOverdue - a.monthsOverdue);
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/staleness.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd app && npx tsc --noEmit
git add src/lib/netWorth/staleness.ts src/lib/netWorth/__tests__/staleness.test.ts
git commit -m "feat(net-worth): flag manually-valued accounts past their review cadence"
```

---
### Task 7: Writes — snapshots, create, close, delete

**Files:**
- Create: `app/src/lib/netWorth/write.ts`
- Test: `app/src/lib/netWorth/__tests__/write.test.ts`

**Interfaces:**
- Consumes: `catalogByKey` from `catalog.ts`; `accounts`, `balanceSnapshots` from `@/db/schema`.
- Produces:
  - `upsertBalanceSnapshot(input: SnapshotInput, db?: Db): Promise<void>` where `SnapshotInput = { accountId: string; asOf: string; balance: number; source?: string; note?: string; valueLow?: number | null; valueHigh?: number | null }`
  - `createNetWorthAccount(input: CreateInput, db?: Db): Promise<string>` where `CreateInput = { catalogKey: string; name: string; value?: number | null; asOf?: string; securedByAccountId?: string | null }`, returning the new account id
  - `closeNetWorthAccount(id: string, closedAtMonth: string, db?: Db): Promise<void>`
  - `deleteNetWorthAccount(id: string, db?: Db): Promise<void>`
  - `class AccountHasHistoryError extends Error`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/netWorth/__tests__/write.test.ts
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, balanceSnapshots } from '@/db/schema';
import {
  upsertBalanceSnapshot, createNetWorthAccount, closeNetWorthAccount,
  deleteNetWorthAccount, AccountHasHistoryError,
} from '@/lib/netWorth/write';

describe('createNetWorthAccount', () => {
  it('fills class, subtype and review cadence from the catalog', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount(
      { catalogKey: 'primary_residence', name: 'Home', value: 1_150_000, asOf: '2026-08-01' }, db);
    const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
    expect(row?.accountClass).toBe('asset');
    expect(row?.subtype).toBe('real_estate');
    expect(row?.reviewIntervalMonths).toBe(12);
    const snaps = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).all();
    expect(snaps).toHaveLength(1);
    expect(snaps[0].balance).toBe(1_150_000);
  });

  it('creates an account with no snapshot when no value is given', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Second car' }, db);
    expect(db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).all()).toHaveLength(0);
  });

  it('links a mortgage to the asset securing it', async () => {
    const { db } = makeTmpDb();
    const house = await createNetWorthAccount({ catalogKey: 'primary_residence', name: 'Home', value: 1 }, db);
    const loan = await createNetWorthAccount(
      { catalogKey: 'mortgage', name: 'Mortgage', value: 620_000, securedByAccountId: house }, db);
    const row = db.select().from(accounts).where(eq(accounts.id, loan)).get();
    expect(row?.securedByAccountId).toBe(house);
    expect(row?.reviewIntervalMonths).toBeNull();
  });

  it('rejects an unknown catalog key', async () => {
    const { db } = makeTmpDb();
    await expect(createNetWorthAccount({ catalogKey: 'nope', name: 'X' }, db)).rejects.toThrow(/unknown catalog/i);
  });
});

describe('upsertBalanceSnapshot', () => {
  it('corrects the same day rather than accumulating rows', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Car' }, db);
    await upsertBalanceSnapshot({ accountId: id, asOf: '2026-08-30', balance: 25_000 }, db);
    await upsertBalanceSnapshot({ accountId: id, asOf: '2026-08-30', balance: 27_000 }, db);
    const rows = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].balance).toBe(27_000);
  });

  // Phase 3 depends on this, but the rule is cheap to enforce from the start.
  it('refuses to let an estimate overwrite a manual entry on the same day', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'primary_residence', name: 'Home' }, db);
    await upsertBalanceSnapshot({ accountId: id, asOf: '2026-08-30', balance: 1_150_000, source: 'manual' }, db);
    await upsertBalanceSnapshot({ accountId: id, asOf: '2026-08-30', balance: 999_000, source: 'estimate' }, db);
    const row = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).get();
    expect(row?.balance).toBe(1_150_000);
    expect(row?.source).toBe('manual');
  });

  it('lets a manual entry overwrite an estimate', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'primary_residence', name: 'Home' }, db);
    await upsertBalanceSnapshot({ accountId: id, asOf: '2026-08-30', balance: 999_000, source: 'estimate' }, db);
    await upsertBalanceSnapshot({ accountId: id, asOf: '2026-08-30', balance: 1_150_000, source: 'manual' }, db);
    const row = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).get();
    expect(row?.balance).toBe(1_150_000);
  });
});

describe('removal', () => {
  it('closes an account without touching its history', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Car', value: 30_000, asOf: '2026-01-01' }, db);
    await closeNetWorthAccount(id, '2026-06', db);
    const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
    expect(row?.status).toBe('closed');
    expect(row?.closedAtMonth).toBe('2026-06');
    expect(db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).all()).toHaveLength(1);
  });

  it('deletes an account that has never been valued', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Typo' }, db);
    await deleteNetWorthAccount(id, db);
    expect(db.select().from(accounts).where(eq(accounts.id, id)).all()).toHaveLength(0);
  });

  it('refuses to delete an account with history', async () => {
    const { db } = makeTmpDb();
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Car', value: 30_000 }, db);
    await expect(deleteNetWorthAccount(id, db)).rejects.toBeInstanceOf(AccountHasHistoryError);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/write.test.ts`
Expected: FAIL — cannot resolve `@/lib/netWorth/write`.

- [ ] **Step 3: Write the implementation**

```ts
// app/src/lib/netWorth/write.ts
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { accounts, balanceSnapshots } from '@/db/schema';
import { catalogByKey } from '@/lib/netWorth/catalog';

type Db = ReturnType<typeof getDb>;

export class AccountHasHistoryError extends Error {
  constructor(public accountId: string) {
    super('This item has recorded values. Close it instead of deleting it, so past periods stay correct.');
    this.name = 'AccountHasHistoryError';
  }
}

export interface SnapshotInput {
  accountId: string;
  asOf: string;
  balance: number;
  source?: string;
  note?: string;
  valueLow?: number | null;
  valueHigh?: number | null;
}

/**
 * Write one dated reading, correcting any existing reading for the same day.
 *
 * An 'estimate' never overwrites a 'manual' row: a number the user typed is a
 * measurement, and a model output must not silently replace it. Everything else
 * overwrites, so re-entering a value on the same day fixes a typo rather than
 * stacking rows.
 */
export async function upsertBalanceSnapshot(input: SnapshotInput, db: Db = getDb()): Promise<void> {
  const now = new Date().toISOString();
  const source = input.source ?? 'manual';
  const existing = db.select().from(balanceSnapshots)
    .where(and(eq(balanceSnapshots.accountId, input.accountId), eq(balanceSnapshots.asOf, input.asOf)))
    .get();

  if (existing) {
    if (existing.source === 'manual' && source === 'estimate') return;
    db.update(balanceSnapshots)
      .set({
        balance: input.balance, source, note: input.note ?? existing.note,
        valueLow: input.valueLow ?? null, valueHigh: input.valueHigh ?? null, modifiedAt: now,
      })
      .where(eq(balanceSnapshots.id, existing.id)).run();
    return;
  }

  db.insert(balanceSnapshots).values({
    id: randomUUID(), accountId: input.accountId, asOf: input.asOf,
    month: input.asOf.slice(0, 7), balance: input.balance, source,
    note: input.note ?? '', valueLow: input.valueLow ?? null, valueHigh: input.valueHigh ?? null,
    createdAt: now, modifiedAt: now,
  }).run();
}

export interface CreateInput {
  catalogKey: string;
  name: string;
  value?: number | null;
  asOf?: string;
  securedByAccountId?: string | null;
}

export async function createNetWorthAccount(input: CreateInput, db: Db = getDb()): Promise<string> {
  const item = catalogByKey(input.catalogKey);
  if (!item) throw new Error(`Unknown catalog key: ${input.catalogKey}`);

  const now = new Date().toISOString();
  const id = randomUUID();
  db.insert(accounts).values({
    id, name: input.name, institution: 'Manual', owner: '',
    accountClass: item.accountClass, purpose: 'portfolio',
    type: item.group === 'debt' ? 'loan' : item.group,
    subtype: item.subtype, origin: 'manual', status: 'active',
    reviewIntervalMonths: item.reviewIntervalMonths,
    securedByAccountId: input.securedByAccountId ?? null,
    createdAt: now, modifiedAt: now,
  }).run();

  // No value is allowed. It lands in missing[] and the add sheet says so before
  // saving — an unvalued item is honest, a zero-valued one is a lie.
  if (input.value !== null && input.value !== undefined) {
    await upsertBalanceSnapshot({
      accountId: id, asOf: input.asOf ?? new Date().toISOString().slice(0, 10),
      balance: input.value, source: 'manual',
    }, db);
  }
  return id;
}

export async function closeNetWorthAccount(id: string, closedAtMonth: string, db: Db = getDb()): Promise<void> {
  db.update(accounts)
    .set({ status: 'closed', closedAtMonth, modifiedAt: new Date().toISOString() })
    .where(eq(accounts.id, id)).run();
}

/**
 * Hard delete, allowed only while the item has no readings.
 *
 * Once anything has been recorded, deletion would rewrite past periods on the
 * trend chart — "I sold my car" must not erase a year of net worth history.
 * That case is a close, not a delete.
 */
export async function deleteNetWorthAccount(id: string, db: Db = getDb()): Promise<void> {
  const any = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).all();
  if (any.length > 0) throw new AccountHasHistoryError(id);
  db.delete(accounts).where(eq(accounts.id, id)).run();
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/write.test.ts`
Expected: PASS, 10 tests.

`valueLow` / `valueHigh` already exist on `balanceSnapshots` — Task 1 added every
column for all three phases in one migration. **Do not modify `schema.ts`.**

- [ ] **Step 5: Commit**

```bash
cd app && npx tsc --noEmit && npm test
git add src/lib/netWorth/write.ts src/lib/netWorth/__tests__/write.test.ts
git commit -m "feat(net-worth): add snapshot upsert, item creation, close and guarded delete"
```

---
### Task 8: API routes

**Files:**
- Create: `app/src/app/api/net-worth/route.ts`, `series/route.ts`, `stale/route.ts`, `snapshot/route.ts`, `accounts/route.ts`, `accounts/[id]/route.ts`
- Test: `app/src/app/api/net-worth/__tests__/route.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–7.
- Produces: the HTTP contract the page consumes.
  - `GET /api/net-worth` → `{ totals: NetWorthTotals, rows: RegisterRow[] }` where `RegisterRow = { accountId, name, side, group, value: number | null, lastAsOf: string | null, source: string | null, reviewIntervalMonths: number | null, securedByAccountId: string | null, valueLow: number | null, valueHigh: number | null, canDelete: boolean }`
  - `GET /api/net-worth/series?from&to&basis` → `{ points: SeriesPoint[] }`
  - `GET /api/net-worth/stale` → `{ stale: StaleAccount[] }`
  - `POST /api/net-worth/snapshot` → `{ ok: true }`
  - `POST /api/net-worth/accounts` → `{ id: string }`
  - `PATCH /api/net-worth/accounts/[id]` → `{ ok: true }`
  - `DELETE /api/net-worth/accounts/[id]` → `{ ok: true }` or `409 { error }`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/app/api/net-worth/__tests__/route.test.ts
import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { vi } from 'vitest';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { GET } from '../route';
import { DELETE } from '../accounts/[id]/route';
import { createNetWorthAccount } from '@/lib/netWorth/write';

const req = (url = 'http://t/api/net-worth') => new Request(url) as never;

describe('GET /api/net-worth', () => {
  it('returns totals and one register row per item', async () => {
    const house = await createNetWorthAccount(
      { catalogKey: 'primary_residence', name: 'Home', value: 1_150_000, asOf: '2026-08-01' }, db);
    await createNetWorthAccount(
      { catalogKey: 'mortgage', name: 'Mortgage', value: 620_000, asOf: '2026-08-01', securedByAccountId: house }, db);

    const body = await (await GET(req())).json();
    expect(body.totals.net).toBe(530_000);
    expect(body.rows).toHaveLength(2);
    const mortgage = body.rows.find((r: { name: string }) => r.name === 'Mortgage');
    expect(mortgage.side).toBe('liability');
    expect(mortgage.securedByAccountId).toBe(house);
    expect(mortgage.canDelete).toBe(false);
  });
});

describe('DELETE /api/net-worth/accounts/[id]', () => {
  it('refuses with 409 once the item has history', async () => {
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Car', value: 30_000 }, db);
    const res = await DELETE(req() , { params: Promise.resolve({ id }) } as never);
    expect(res.status).toBe(409);
  });

  it('deletes an item that has never been valued', async () => {
    const id = await createNetWorthAccount({ catalogKey: 'car', name: 'Typo' }, db);
    const res = await DELETE(req(), { params: Promise.resolve({ id }) } as never);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/app/api/net-worth/__tests__/route.test.ts`
Expected: FAIL — cannot resolve `../route`.

- [ ] **Step 3: Write `GET /api/net-worth`**

```ts
// app/src/app/api/net-worth/route.ts
import { NextResponse } from 'next/server';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { netWorthAt } from '@/lib/netWorth/rollup';
import { valuationAt } from '@/lib/netWorth/valuation';
import { netWorthSide } from '@/lib/netWorth/side';
import { groupForSubtype } from '@/lib/netWorth/catalog';

// GET /api/net-worth — current totals plus one row per item for the register.
export async function GET() {
  try {
    const ctx = await loadNetWorthContext();
    const today = new Date().toISOString().slice(0, 10);
    const totals = netWorthAt(ctx, today);

    const rows = ctx.accounts
      .filter((a) => netWorthSide(a) !== 'excluded' && a.status !== 'closed')
      .map((a) => {
        const readings = [...ctx.balances, ...ctx.investments]
          .filter((r) => r.accountId === a.id)
          .sort((x, y) => (x.asOf < y.asOf ? 1 : -1));
        const latest = readings[0] ?? null;
        return {
          accountId: a.id,
          name: a.name,
          side: netWorthSide(a),
          group: groupForSubtype(a.subtype ?? ''),
          value: valuationAt(ctx, a.id, today),
          lastAsOf: latest?.asOf ?? null,
          source: latest?.source ?? null,
          reviewIntervalMonths: a.reviewIntervalMonths ?? null,
          securedByAccountId: a.securedByAccountId ?? null,
          valueLow: null as number | null,
          valueHigh: null as number | null,
          // Delete is offered only while nothing has been recorded; otherwise the
          // only safe removal is a close, which preserves past periods.
          canDelete: readings.length === 0,
        };
      });

    return NextResponse.json({ totals, rows });
  } catch (error) {
    console.error('Error building net worth:', error);
    return NextResponse.json({ error: 'Failed to build net worth' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Write the remaining five routes**

```ts
// app/src/app/api/net-worth/series/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { netWorthSeries } from '@/lib/netWorth/rollup';
import type { AllocationBasis } from '@/lib/investments/periods';

export async function GET(request: NextRequest) {
  try {
    const q = new URL(request.url).searchParams;
    const basis = (['monthly', 'quarterly', 'yearly'].includes(q.get('basis') ?? '')
      ? q.get('basis') : 'monthly') as AllocationBasis;
    const today = new Date().toISOString().slice(0, 10);
    const ctx = await loadNetWorthContext();
    const earliest = [...ctx.balances, ...ctx.investments].map((r) => r.asOf).sort()[0] ?? today;
    const from = q.get('from') || earliest;
    const to = q.get('to') || today;
    return NextResponse.json({ points: netWorthSeries(ctx, from, to, basis).filter((p) => p.date <= today) });
  } catch (error) {
    console.error('Error building net worth series:', error);
    return NextResponse.json({ error: 'Failed to build net worth series' }, { status: 500 });
  }
}
```

```ts
// app/src/app/api/net-worth/stale/route.ts
import { NextResponse } from 'next/server';
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { staleAccounts } from '@/lib/netWorth/staleness';

export async function GET() {
  try {
    const ctx = await loadNetWorthContext();
    return NextResponse.json({ stale: staleAccounts(ctx, new Date().toISOString().slice(0, 10)) });
  } catch (error) {
    console.error('Error listing stale accounts:', error);
    return NextResponse.json({ error: 'Failed to list stale accounts' }, { status: 500 });
  }
}
```

```ts
// app/src/app/api/net-worth/snapshot/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { upsertBalanceSnapshot } from '@/lib/netWorth/write';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      accountId?: string; asOf?: string; balance?: number; note?: string;
    };
    if (!body.accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
    if (typeof body.balance !== 'number' || !Number.isFinite(body.balance)) {
      return NextResponse.json({ error: 'balance must be a number' }, { status: 400 });
    }
    if (body.balance < 0) {
      return NextResponse.json(
        { error: 'balance must be a positive magnitude; direction comes from the account class' },
        { status: 400 });
    }
    await upsertBalanceSnapshot({
      accountId: body.accountId,
      asOf: body.asOf ?? new Date().toISOString().slice(0, 10),
      balance: body.balance, source: 'manual', note: body.note ?? '',
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error writing balance snapshot:', error);
    return NextResponse.json({ error: 'Failed to write balance snapshot' }, { status: 500 });
  }
}
```

```ts
// app/src/app/api/net-worth/accounts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createNetWorthAccount } from '@/lib/netWorth/write';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      catalogKey?: string; name?: string; value?: number | null;
      asOf?: string; securedByAccountId?: string | null;
    };
    if (!body.catalogKey || !body.name) {
      return NextResponse.json({ error: 'catalogKey and name are required' }, { status: 400 });
    }
    const id = await createNetWorthAccount({
      catalogKey: body.catalogKey, name: body.name, value: body.value ?? null,
      asOf: body.asOf, securedByAccountId: body.securedByAccountId ?? null,
    });
    return NextResponse.json({ id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create item';
    const status = /unknown catalog/i.test(message) ? 400 : 500;
    if (status === 500) console.error('Error creating net worth item:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
```

```ts
// app/src/app/api/net-worth/accounts/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { accounts } from '@/db/schema';
import { closeNetWorthAccount, deleteNetWorthAccount, AccountHasHistoryError } from '@/lib/netWorth/write';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const body = await request.json() as {
      name?: string; reviewIntervalMonths?: number | null;
      securedByAccountId?: string | null; closedAtMonth?: string;
    };
    if (body.closedAtMonth) {
      await closeNetWorthAccount(id, body.closedAtMonth);
      return NextResponse.json({ ok: true });
    }
    const patch: Record<string, unknown> = { modifiedAt: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.reviewIntervalMonths !== undefined) patch.reviewIntervalMonths = body.reviewIntervalMonths;
    if (body.securedByAccountId !== undefined) patch.securedByAccountId = body.securedByAccountId;
    getDb().update(accounts).set(patch).where(eq(accounts.id, id)).run();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error updating net worth item:', error);
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteNetWorthAccount(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AccountHasHistoryError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Error deleting net worth item:', error);
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `cd app && npx vitest run src/app/api/net-worth/__tests__/route.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
cd app && npx tsc --noEmit && npm test
git add src/app/api/net-worth src/app/api/net-worth/__tests__
git commit -m "feat(net-worth): expose totals, series, staleness and mutation routes"
```

---
## Phase 1 (continued) — UI

### Task 9: Nav entry and page shell

**Files:**
- Create: `app/src/app/net-worth/page.tsx`, and stub files for all six `app/src/app/components/netWorth/*.tsx`
- Modify: `app/src/app/components/AppHeader.tsx:13-19` (the `NAV` array)
- Test: `app/src/app/components/__tests__/AppHeader.netWorth.test.tsx`

**Interfaces:**
- Consumes: `GET /api/net-worth` from Task 8; `useTimeRange` from `@/app/hooks/useTimeRange`; `TimeRangeDropdown`.
- Produces: the `/net-worth` route; page-local state `{ totals, rows }` that Tasks 10–13 render into.

- [ ] **Step 1: Write the failing test**

```tsx
// app/src/app/components/__tests__/AppHeader.netWorth.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppHeader from '@/app/components/AppHeader';

vi.mock('next/navigation', () => ({
  usePathname: () => '/net-worth',
  useRouter: () => ({ push: vi.fn() }),
}));

describe('AppHeader', () => {
  it('offers Net worth in the nav and marks it current on its route', () => {
    render(<AppHeader />);
    const link = screen.getByRole('link', { name: 'Net worth' });
    expect(link).toHaveAttribute('href', '/net-worth');
    expect(link).toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/app/components/__tests__/AppHeader.netWorth.test.tsx`
Expected: FAIL — no link named "Net worth".

- [ ] **Step 3: Add the nav entry**

In `app/src/app/components/AppHeader.tsx`, insert into `NAV` immediately after Home. The array comment says order follows visit frequency, and the balance sheet is checked more often than the allocation tree:

```ts
const NAV = [
  { href: '/', label: 'Home' },
  { href: '/net-worth', label: 'Net worth' },
  { href: '/investments', label: 'Investments' },
  { href: '/investments/reserve', label: 'Reserve' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/rules', label: 'Rules' },
];
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd app && npx vitest run src/app/components/__tests__/AppHeader.netWorth.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the page shell**

```tsx
// app/src/app/net-worth/page.tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import TimeRangeDropdown from '@/app/components/TimeRangeDropdown';
import { useTimeRange } from '@/app/hooks/useTimeRange';
import { useRefreshOnFocus } from '@/app/hooks/useRefreshOnFocus';
import { onDataChanged } from '@/lib/dataEvents';
import { formatCurrency } from '@/lib/chartConfig';

export interface RegisterRow {
  accountId: string;
  name: string;
  side: 'asset' | 'liability';
  group: string;
  value: number | null;
  lastAsOf: string | null;
  source: string | null;
  reviewIntervalMonths: number | null;
  securedByAccountId: string | null;
  valueLow: number | null;
  valueHigh: number | null;
  canDelete: boolean;
}

export interface Totals {
  assetsLiquid: number; assetsIlliquid: number; assets: number;
  liabilities: number; net: number; missing: string[];
}

export default function NetWorthPage() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { preset, customRange, dateRange, handleChange } = useTimeRange();
  const didInitialLoad = useRef(false);

  const load = useCallback(async () => {
    const initial = !didInitialLoad.current;
    if (initial) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/net-worth', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`);
      setTotals(body.totals);
      setRows(body.rows);
    } catch (e) {
      // A failed request must not fall through to an empty balance sheet.
      // "$0 net worth" and "the server is down" look identical otherwise.
      setTotals(null);
      setRows([]);
      setError(e instanceof Error ? e.message : 'Could not load net worth.');
    } finally {
      didInitialLoad.current = true;
      if (initial) setLoading(false);
    }
  }, []);

  const refreshAll = useCallback(() => {
    setRefreshKey((k) => k + 1);
    void load();
  }, [load]);

  useEffect(() => { refreshAll(); }, [refreshAll]);
  useRefreshOnFocus(refreshAll);
  useEffect(() => onDataChanged(refreshAll), [refreshAll]);

  return (
    <main className="min-h-screen p-[var(--space-6)] max-w-6xl mx-auto">
      <h1 className="heading-large text-[var(--color-text-base-default)] mb-[var(--space-6)]">Net worth</h1>

      {loading ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">Loading…</p>
      ) : error ? (
        <div className="origin-card p-[var(--space-4)] border-[var(--color-border-critical)] bg-[var(--color-background-critical-subdued)]">
          <h2 className="text-small font-medium text-[var(--color-text-critical)]">Could not load net worth</h2>
          <p className="mt-[var(--space-1)] text-small text-[var(--color-text-critical)]">{error}</p>
          <p className="mt-[var(--space-2)] text-xsmall text-[var(--color-text-base-subdued)]">
            No figure is shown because none is known — this is a load failure, not an empty balance sheet.
          </p>
          <button type="button" onClick={() => { void load(); }} className="origin-btn origin-btn-secondary mt-[var(--space-3)]">
            Retry
          </button>
        </div>
      ) : totals ? (
        <div className="space-y-[var(--space-6)]">
          <div>
            <p className="text-small text-[var(--color-text-base-subdued)]">Net worth</p>
            <p className="heading-large text-[var(--color-text-base-default)]">{formatCurrency(totals.net)}</p>
            <p className="text-xsmall text-[var(--color-text-base-subdued)]">
              {formatCurrency(totals.assets)} in assets, {formatCurrency(totals.liabilities)} in debt
            </p>
          </div>

          {totals.missing.length > 0 && (
            /* Never absorbed as zero. The total is real but incomplete, and
               saying which items are missing is what keeps it honest. */
            <div className="origin-card p-[var(--space-3)]">
              <p className="text-small text-[var(--color-text-base-default)]">
                This excludes {totals.missing.length} item{totals.missing.length === 1 ? '' : 's'} you
                haven&apos;t valued yet: {totals.missing.join(', ')}.
              </p>
            </div>
          )}

          <TimeRangeDropdown preset={preset} customRange={customRange} onChange={handleChange} />

          <NetWorthChart from={dateRange.startDate} to={dateRange.endDate} basis="monthly" refreshKey={refreshKey} />
          <NetWorthWaterfall rows={rows} />
          <StaleStrip refreshKey={refreshKey} />
          <BalanceSheet rows={rows} onChanged={refreshAll} />
          <MissedItemsHint rows={rows} />
        </div>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 6: Create the six component stubs**

Every section is mounted above, so each must exist as a file before the page
compiles. Create these as minimal stubs that render nothing; Tasks 10–13 replace
their contents and **never touch `page.tsx`**, which is what lets those tasks run
in parallel without conflicting on this file.

```tsx
// app/src/app/components/netWorth/NetWorthChart.tsx
'use client';
export default function NetWorthChart(_props: {
  from: string; to: string; basis: string; refreshKey: number;
}) { return null; }
```

```tsx
// app/src/app/components/netWorth/NetWorthWaterfall.tsx
'use client';
import type { RegisterRow } from '@/app/net-worth/page';
export default function NetWorthWaterfall(_props: { rows: RegisterRow[] }) { return null; }
```

```tsx
// app/src/app/components/netWorth/StaleStrip.tsx
'use client';
export default function StaleStrip(_props: { refreshKey: number }) { return null; }
```

```tsx
// app/src/app/components/netWorth/BalanceSheet.tsx
'use client';
import type { RegisterRow } from '@/app/net-worth/page';
export default function BalanceSheet(_props: {
  rows: RegisterRow[]; onChanged: () => void;
}) { return null; }
```

```tsx
// app/src/app/components/netWorth/MissedItemsHint.tsx
'use client';
import type { RegisterRow } from '@/app/net-worth/page';
export default function MissedItemsHint(_props: { rows: RegisterRow[] }) { return null; }
```

```tsx
// app/src/app/components/netWorth/AddItemSheet.tsx
'use client';
import type { RegisterRow } from '@/app/net-worth/page';
export default function AddItemSheet(_props: {
  side: 'asset' | 'liability'; existingAssets: RegisterRow[]; onCreated: () => void;
}) { return null; }
```

Import all five mounted components at the top of `page.tsx`. `AddItemSheet` is not
mounted here — `BalanceSheet` mounts it in Task 13.

- [ ] **Step 7: Verify the page renders**

Run: `cd app && npm run dev`, open http://localhost:3000/net-worth, confirm the heading and either the hero or the empty state renders with no console errors. Stop with `lsof -ti:3000 | xargs kill -9`.

- [ ] **Step 7: Commit**

```bash
cd app && npx tsc --noEmit && npm test
git add src/app/net-worth src/app/components/netWorth src/app/components/AppHeader.tsx src/app/components/__tests__/AppHeader.netWorth.test.tsx
git commit -m "feat(net-worth): add the net worth route, nav entry, hero and section stubs"
```

---

### Task 10: Trend chart

**Files:**
- Modify: `app/src/app/components/netWorth/NetWorthChart.tsx` (replace the Task 9 stub)

**Interfaces:**
- Consumes: `GET /api/net-worth/series`; `CHART_PALETTE`, `CHART_DANGER`, `CHART_INK`, `formatCurrency` from `@/lib/chartConfig`.
- Produces: `<NetWorthChart from={string} to={string} basis="monthly" refreshKey={number} />`.

Assets stack **above** zero in two segments; liabilities go **below** zero; net worth is a line through both. Debt below the baseline rather than netted away is the point of this visual — an $800k house against a $500k mortgage must not read like an $800k asset.

- [ ] **Step 1: Write the component**

```tsx
// app/src/app/components/netWorth/NetWorthChart.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Chart } from 'react-chartjs-2';
import type { ChartOptions, ChartData } from 'chart.js';
import '@/lib/chartConfig';
import { CHART_PALETTE, CHART_DANGER, CHART_INK, formatCurrency } from '@/lib/chartConfig';

interface Point {
  key: string; label: string; date: string;
  assetsLiquid: number; assetsIlliquid: number; liabilities: number; net: number;
  missing: string[];
}

interface Props { from: string; to: string; basis: string; refreshKey: number }

export default function NetWorthChart({ from, to, basis, refreshKey }: Props) {
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/net-worth/series?from=${from}&to=${to}&basis=${basis}`, { cache: 'no-store' });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        if (!cancelled) { setPoints(body.points); setError(null); }
      } catch (e) {
        if (!cancelled) { setPoints([]); setError(e instanceof Error ? e.message : 'Could not load the trend.'); }
      }
    })();
    return () => { cancelled = true; };
  }, [from, to, basis, refreshKey]);

  const data: ChartData<'bar' | 'line'> = useMemo(() => ({
    labels: points.map((p) => p.label),
    datasets: [
      {
        type: 'bar' as const, label: 'Cash & investments', stack: 'assets',
        data: points.map((p) => p.assetsLiquid),
        backgroundColor: CHART_PALETTE[0], borderWidth: 0,
      },
      {
        type: 'bar' as const, label: 'Property, vehicles & other', stack: 'assets',
        data: points.map((p) => p.assetsIlliquid),
        backgroundColor: CHART_PALETTE[2], borderWidth: 0,
      },
      {
        // Negated for display only. The stored value is a positive magnitude;
        // this is the one place the sign is applied, and it is presentational.
        type: 'bar' as const, label: 'Debt', stack: 'debt',
        data: points.map((p) => -p.liabilities),
        backgroundColor: CHART_DANGER, borderWidth: 0,
      },
      {
        type: 'line' as const, label: 'Net worth',
        data: points.map((p) => p.net),
        borderColor: CHART_INK, backgroundColor: CHART_INK,
        borderWidth: 2, tension: 0.2, pointRadius: 3, order: 0,
      },
    ],
  }), [points]);

  const options: ChartOptions<'bar' | 'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: { stacked: true, grid: { display: false } },
      // One y-axis for everything. Assets and debt share a scale so their
      // relative size is readable; a second axis would make the comparison a lie.
      y: {
        stacked: true,
        ticks: { callback: (v) => formatCurrency(Number(v)) },
      },
    },
    plugins: {
      legend: { display: true, position: 'bottom' as const },
      tooltip: {
        callbacks: {
          label: (c) => `${c.dataset.label}: ${formatCurrency(Math.abs(Number(c.parsed.y)))}`,
          afterBody: (items) => {
            const p = points[items[0].dataIndex];
            return p?.missing.length ? [`Excludes ${p.missing.length} unvalued item(s)`] : [];
          },
        },
      },
    },
  }), [points]);

  if (error) {
    return <p className="text-small text-[var(--color-text-critical)]">{error}</p>;
  }
  if (points.length === 0) {
    return <p className="text-small text-[var(--color-text-base-subdued)]">No readings in this range yet.</p>;
  }

  return (
    <div className="origin-card-elevated p-[var(--space-6)]">
      <h2 className="heading-xsmall text-[var(--color-text-base-default)] mb-[var(--space-3)]">Net worth over time</h2>
      <div style={{ height: 320 }}>
        <Chart type="bar" data={data} options={options} />
      </div>
    </div>
  );
}
```

**Replace the stub's contents only.** Task 9 already mounts this component on the
page — do not edit `page.tsx`, or this task will conflict with the other UI tasks
running alongside it.

- [ ] **Step 2: Verify visually**

Run `cd app && npm run dev`, seed at least two months of readings through the register or directly with `sqlite3`, and confirm: assets stack above zero, debt renders below zero, the net line crosses both, and the legend names all four series. Stop the server.

- [ ] **Step 3: Commit**

```bash
cd app && npx tsc --noEmit
git add src/app/components/netWorth/NetWorthChart.tsx
git commit -m "feat(net-worth): chart assets above zero and debt below with a net worth line"
```

---
### Task 11: Waterfall

**Files:**
- Modify: `app/src/app/components/netWorth/NetWorthWaterfall.tsx` (replace the Task 9 stub)
- Test: `app/src/app/components/netWorth/__tests__/waterfall.test.ts`

**Interfaces:**
- Consumes: `RegisterRow[]` already held by the page — no new endpoint.
- Produces: `<NetWorthWaterfall rows={RegisterRow[]} net={number} />` and the pure `buildWaterfall(rows: RegisterRow[]): WaterfallStep[]` where `WaterfallStep = { label: string; delta: number; runningAfter: number; kind: 'asset' | 'liability' | 'total' }`.

Range-independent — it always describes today, following the Reserve tile precedent. It steps through asset groups individually rather than one "assets" bar, so it stays informative for a household with few liabilities.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/app/components/netWorth/__tests__/waterfall.test.ts
import { describe, it, expect } from 'vitest';
import { buildWaterfall } from '@/app/components/netWorth/NetWorthWaterfall';
import type { RegisterRow } from '@/app/net-worth/page';

const row = (over: Partial<RegisterRow>): RegisterRow => ({
  accountId: 'x', name: 'X', side: 'asset', group: 'other', value: 0,
  lastAsOf: '2026-08-01', source: 'manual', reviewIntervalMonths: null,
  securedByAccountId: null, valueLow: null, valueHigh: null, canDelete: false, ...over,
});

describe('buildWaterfall', () => {
  it('steps down from asset groups through debts to the net figure', () => {
    const steps = buildWaterfall([
      row({ name: 'Checking', group: 'cash', value: 85_000 }),
      row({ name: 'Home', group: 'property', value: 1_150_000 }),
      row({ name: 'Mortgage', group: 'debt', side: 'liability', value: 620_000 }),
    ]);
    expect(steps.map((s) => s.label)).toEqual(['Cash', 'Property', 'Mortgage', 'Net worth']);
    expect(steps[0].runningAfter).toBe(85_000);
    expect(steps[1].runningAfter).toBe(1_235_000);
    expect(steps[2].delta).toBe(-620_000);
    expect(steps.at(-1)).toMatchObject({ kind: 'total', runningAfter: 615_000 });
  });

  it('skips a group with no valued items rather than drawing a zero bar', () => {
    const steps = buildWaterfall([row({ name: 'Checking', group: 'cash', value: 85_000 })]);
    expect(steps.map((s) => s.label)).toEqual(['Cash', 'Net worth']);
  });

  it('ignores unvalued items entirely', () => {
    const steps = buildWaterfall([
      row({ name: 'Checking', group: 'cash', value: 85_000 }),
      row({ name: 'Second car', group: 'vehicles', value: null }),
    ]);
    expect(steps.map((s) => s.label)).toEqual(['Cash', 'Net worth']);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/app/components/netWorth/__tests__/waterfall.test.ts`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Write the component**

```tsx
// app/src/app/components/netWorth/NetWorthWaterfall.tsx
'use client';

import { useMemo } from 'react';
import { CHART_PALETTE, CHART_DANGER, CHART_INK, formatCurrency } from '@/lib/chartConfig';
import type { RegisterRow } from '@/app/net-worth/page';

export interface WaterfallStep {
  label: string;
  delta: number;
  runningAfter: number;
  kind: 'asset' | 'liability' | 'total';
}

const ASSET_ORDER: Array<[string, string]> = [
  ['cash', 'Cash'],
  ['investments', 'Investments'],
  ['property', 'Property'],
  ['vehicles', 'Vehicles'],
  ['other', 'Other assets'],
];

/**
 * Gross assets by group, then each debt, then the net figure.
 *
 * Groups with nothing valued in them are omitted rather than drawn as zero
 * bars — an empty step reads as "you have none of this", which is a claim the
 * data does not support when the item simply has not been valued.
 */
export function buildWaterfall(rows: RegisterRow[]): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  let running = 0;

  for (const [group, label] of ASSET_ORDER) {
    const total = rows
      .filter((r) => r.side === 'asset' && r.group === group && r.value !== null)
      .reduce((sum, r) => sum + (r.value ?? 0), 0);
    if (total === 0) continue;
    running += total;
    steps.push({ label, delta: total, runningAfter: running, kind: 'asset' });
  }

  for (const r of rows.filter((x) => x.side === 'liability' && x.value !== null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))) {
    running -= r.value ?? 0;
    steps.push({ label: r.name, delta: -(r.value ?? 0), runningAfter: running, kind: 'liability' });
  }

  steps.push({ label: 'Net worth', delta: running, runningAfter: running, kind: 'total' });
  return steps;
}

export default function NetWorthWaterfall({ rows }: { rows: RegisterRow[] }) {
  const steps = useMemo(() => buildWaterfall(rows), [rows]);
  const peak = Math.max(...steps.map((s) => Math.max(s.runningAfter, s.runningAfter - s.delta)), 1);

  const color = (kind: WaterfallStep['kind']) =>
    kind === 'liability' ? CHART_DANGER : kind === 'total' ? CHART_INK : CHART_PALETTE[0];

  return (
    <div className="origin-card-elevated p-[var(--space-6)]">
      <h2 className="heading-xsmall text-[var(--color-text-base-default)]">Where it stands today</h2>
      <p className="text-xsmall text-[var(--color-text-base-subdued)] mb-[var(--space-4)]">
        Current values only — this section ignores the selected time range.
      </p>
      <div className="flex items-end gap-[var(--space-2)]" style={{ height: 200 }}>
        {steps.map((s) => {
          const top = Math.max(s.runningAfter, s.runningAfter - s.delta);
          const bottom = Math.min(s.runningAfter, s.runningAfter - s.delta);
          const height = ((top - bottom) / peak) * 160;
          const offset = (bottom / peak) * 160;
          return (
            <div key={s.label} className="flex-1 flex flex-col items-center justify-end" style={{ height: 200 }}>
              <div
                title={`${s.label}: ${formatCurrency(s.delta)}`}
                style={{
                  width: '100%', height: Math.max(height, 3), marginBottom: offset,
                  background: color(s.kind), borderRadius: 4,
                }}
              />
              <span className="text-xsmall text-[var(--color-text-base-subdued)] mt-[var(--space-1)] text-center">
                {s.label}
              </span>
              <span className="text-xsmall text-[var(--color-text-base-default)] tabular-nums">
                {formatCurrency(s.delta)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd app && npx vitest run src/app/components/netWorth/__tests__/waterfall.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

Task 9 already mounts this. **Do not edit `page.tsx`.**

```bash
cd app && npx tsc --noEmit && npm test
git add src/app/components/netWorth/NetWorthWaterfall.tsx src/app/components/netWorth/__tests__/waterfall.test.ts
git commit -m "feat(net-worth): add a gross-to-net waterfall for today's balance sheet"
```

---

### Task 12: Register with inline editing, and the stale strip

**Files:**
- Modify: `app/src/app/components/netWorth/BalanceSheet.tsx`, `app/src/app/components/netWorth/StaleStrip.tsx` (replace the Task 9 stubs)
- Test: `app/src/app/components/netWorth/__tests__/BalanceSheet.test.tsx`

**Interfaces:**
- Consumes: `RegisterRow[]`; `POST /api/net-worth/snapshot`; `GET /api/net-worth/stale`; `notifyDataChanged` from `@/lib/dataEvents`.
- Produces: `<BalanceSheet rows={RegisterRow[]} onChanged={() => void} />`, `<StaleStrip refreshKey={number} onChanged={() => void} />`.

The critical interaction: **type a number into the row and press enter.** No modal, no wizard. If updating a value takes more than a couple of seconds the feature dies of neglect.

- [ ] **Step 1: Write the failing test**

```tsx
// app/src/app/components/netWorth/__tests__/BalanceSheet.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BalanceSheet from '@/app/components/netWorth/BalanceSheet';
import type { RegisterRow } from '@/app/net-worth/page';

const row = (over: Partial<RegisterRow>): RegisterRow => ({
  accountId: 'a1', name: 'Home', side: 'asset', group: 'property', value: 1_150_000,
  lastAsOf: '2026-08-01', source: 'manual', reviewIntervalMonths: 12,
  securedByAccountId: null, valueLow: null, valueHigh: null, canDelete: false, ...over,
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
});

describe('BalanceSheet', () => {
  it('posts a snapshot when a value is typed and entered', async () => {
    const onChanged = vi.fn();
    render(<BalanceSheet rows={[row({})]} onChanged={onChanged} />);
    const input = screen.getByLabelText('Value for Home');
    fireEvent.change(input, { target: { value: '1200000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body).balance).toBe(1200000);
  });

  it('renders an unvalued item as an em dash, never as zero', () => {
    render(<BalanceSheet rows={[row({ name: 'Second car', value: null, lastAsOf: null })]} onChanged={vi.fn()} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('rejects a negative value inline without posting', async () => {
    const onChanged = vi.fn();
    render(<BalanceSheet rows={[row({})]} onChanged={onChanged} />);
    const input = screen.getByLabelText('Value for Home');
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText(/positive amount/i)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('nests a secured liability under its asset and shows the equity', () => {
    const mortgage = row({ accountId: 'a2', name: 'Mortgage', side: 'liability', group: 'debt', value: 620_000, securedByAccountId: 'a1' });
    render(<BalanceSheet rows={[row({}), mortgage]} onChanged={vi.fn()} />);
    // The house is worth 1,150,000 against a 620,000 mortgage: equity is 530,000.
    expect(screen.getByTestId('equity-a1')).toHaveTextContent('530,000');
  });

  it('separates assets from liabilities and totals each side', () => {
    render(<BalanceSheet rows={[row({}), row({ accountId: 'a2', name: 'Mortgage', side: 'liability', group: 'debt', value: 620_000 })]} onChanged={vi.fn()} />);
    expect(screen.getByTestId('assets-total')).toHaveTextContent('1,150,000');
    expect(screen.getByTestId('liabilities-total')).toHaveTextContent('620,000');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/app/components/netWorth/__tests__/BalanceSheet.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Write `BalanceSheet.tsx`**

```tsx
// app/src/app/components/netWorth/BalanceSheet.tsx
'use client';

import { useState } from 'react';
import { formatCurrency } from '@/lib/chartConfig';
import { notifyDataChanged } from '@/lib/dataEvents';
import type { RegisterRow } from '@/app/net-worth/page';

function ageLabel(lastAsOf: string | null, interval: number | null): { text: string; stale: boolean } {
  if (!lastAsOf) return { text: 'never valued', stale: true };
  const months =
    (new Date().getFullYear() - Number(lastAsOf.slice(0, 4))) * 12 +
    (new Date().getMonth() + 1 - Number(lastAsOf.slice(5, 7)));
  const stale = interval !== null && months > interval;
  return { text: `as of ${lastAsOf}`, stale };
}

function Row({ row, onChanged }: { row: RegisterRow; onChanged: () => void }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const age = ageLabel(row.lastAsOf, row.reviewIntervalMonths);

  async function commit() {
    const parsed = Number(draft.replace(/[$,\s]/g, ''));
    if (draft.trim() === '') return;
    if (!Number.isFinite(parsed) || parsed < 0) {
      // Balances are magnitudes; direction comes from the account's class.
      setError('Enter a positive amount — debts are entered as what you owe.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/net-worth/snapshot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: row.accountId, balance: parsed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
      }
      setDraft('');
      notifyDataChanged();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]">
      <div>
        <p className="text-small text-[var(--color-text-base-default)]">{row.name}</p>
        <p
          className="text-xsmall"
          style={{ color: age.stale ? 'var(--color-text-warning)' : 'var(--color-text-base-subdued)' }}
        >
          {age.text}
          {row.source === 'estimate' ? ' · estimate' : ''}
        </p>
        {error && <p className="text-xsmall text-[var(--color-text-critical)]">{error}</p>}
      </div>
      <div className="flex items-center gap-[var(--space-2)]">
        {/* An unvalued item is an em dash, never $0. The difference is the point. */}
        <span className="text-small text-[var(--color-text-base-default)] tabular-nums">
          {row.value === null ? '—' : formatCurrency(row.value)}
        </span>
        <input
          aria-label={`Value for ${row.name}`}
          className="origin-input w-28"
          inputMode="decimal"
          placeholder="update"
          value={draft}
          disabled={saving}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void commit(); }}
          onBlur={() => { if (draft.trim() !== '') void commit(); }}
        />
      </div>
    </div>
  );
}

/**
 * The debt secured against one asset, and what is left over.
 *
 * Rendered as a sub-line under the asset rather than as its own row: an $800k
 * house against a $500k mortgage must not read like an $800k asset. The
 * liability still appears in full in the Liabilities column — this is a nesting
 * for legibility, not a second copy, so nothing is double-counted.
 */
function SecuredUnder({ asset, allRows }: { asset: RegisterRow; allRows: RegisterRow[] }) {
  const secured = allRows.filter((r) => r.securedByAccountId === asset.accountId && r.value !== null);
  if (secured.length === 0 || asset.value === null) return null;
  const debt = secured.reduce((sum, r) => sum + (r.value ?? 0), 0);
  return (
    <div className="pl-[var(--space-4)] pb-[var(--space-2)]">
      {secured.map((r) => (
        <p key={r.accountId} className="text-xsmall text-[var(--color-text-base-subdued)]">
          less {r.name} {formatCurrency(r.value ?? 0)}
        </p>
      ))}
      <p className="text-xsmall text-[var(--color-text-base-default)]">
        equity <span data-testid={`equity-${asset.accountId}`} className="tabular-nums">
          {formatCurrency(asset.value - debt)}
        </span>
      </p>
    </div>
  );
}

function Column({ title, rows, allRows, testId, onChanged }: {
  title: string; rows: RegisterRow[]; allRows: RegisterRow[]; testId: string; onChanged: () => void;
}) {
  const total = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
  return (
    <div className="origin-card p-[var(--space-4)]">
      <h3 className="text-small text-[var(--color-text-base-subdued)] mb-[var(--space-2)]">{title}</h3>
      {rows.length === 0
        ? <p className="text-xsmall text-[var(--color-text-base-subdued)]">Nothing here yet.</p>
        : rows.map((r) => (
            <div key={r.accountId}>
              <Row row={r} onChanged={onChanged} />
              <SecuredUnder asset={r} allRows={allRows} />
            </div>
          ))}
      <div className="flex justify-between border-t border-[var(--color-border-base-subdued)] mt-[var(--space-2)] pt-[var(--space-2)]">
        <span className="text-small text-[var(--color-text-base-subdued)]">Total</span>
        <span data-testid={testId} className="text-small text-[var(--color-text-base-default)] tabular-nums">
          {formatCurrency(total)}
        </span>
      </div>
    </div>
  );
}

export default function BalanceSheet({ rows, onChanged }: { rows: RegisterRow[]; onChanged: () => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-4)]">
      <Column title="Assets" testId="assets-total" onChanged={onChanged} allRows={rows}
        rows={rows.filter((r) => r.side === 'asset')} />
      <Column title="Liabilities" testId="liabilities-total" onChanged={onChanged} allRows={rows}
        rows={rows.filter((r) => r.side === 'liability')} />
    </div>
  );
}
```

- [ ] **Step 4: Write `StaleStrip.tsx`**

```tsx
// app/src/app/components/netWorth/StaleStrip.tsx
'use client';

import { useEffect, useState } from 'react';

interface Stale { accountId: string; name: string; lastAsOf: string | null; monthsOverdue: number }

export default function StaleStrip({ refreshKey }: { refreshKey: number }) {
  const [stale, setStale] = useState<Stale[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/net-worth/stale', { cache: 'no-store' });
        const body = await res.json();
        if (!cancelled && res.ok) setStale(body.stale ?? []);
      } catch {
        // A failed staleness check is not worth an error state — the register
        // still shows each row's age, which is the same information.
        if (!cancelled) setStale([]);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (stale.length === 0) return null;

  return (
    <div className="origin-card p-[var(--space-3)]">
      <p className="text-small text-[var(--color-text-base-default)]">
        Needs a look — {stale.length} item{stale.length === 1 ? '' : 's'} past their review date
      </p>
      <p className="text-xsmall text-[var(--color-text-base-subdued)]">
        {stale.map((s) => `${s.name} (${s.lastAsOf ?? 'never valued'})`).join(' · ')}
      </p>
      <p className="text-xsmall text-[var(--color-text-base-subdued)] mt-[var(--space-1)]">
        Their last value still counts toward your net worth — update them in the register below.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `cd app && npx vitest run src/app/components/netWorth/__tests__/BalanceSheet.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

Task 9 already mounts both. **Do not edit `page.tsx`.**

```bash
cd app && npx tsc --noEmit && npm test
git add src/app/components/netWorth
git commit -m "feat(net-worth): add the register with inline value editing and a staleness strip"
```

---
### Task 13: Add item sheet, close and delete

**Files:**
- Modify: `app/src/app/components/netWorth/AddItemSheet.tsx` and `MissedItemsHint.tsx` (replace the Task 9 stubs), `app/src/app/components/netWorth/BalanceSheet.tsx` (per-row remove control)
- Test: `app/src/app/components/netWorth/__tests__/AddItemSheet.test.tsx`

**Interfaces:**
- Consumes: `CATALOG`, `catalogByKey` from `@/lib/netWorth/catalog`; `POST /api/net-worth/accounts`; `PATCH`/`DELETE /api/net-worth/accounts/[id]`.
- Produces: `<AddItemSheet side="asset" | "liability" existingAssets={RegisterRow[]} onCreated={() => void} />`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/src/app/components/netWorth/__tests__/AddItemSheet.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddItemSheet from '@/app/components/netWorth/AddItemSheet';
import type { RegisterRow } from '@/app/net-worth/page';

const house: RegisterRow = {
  accountId: 'house-1', name: 'Home', side: 'asset', group: 'property', value: 1_150_000,
  lastAsOf: '2026-08-01', source: 'manual', reviewIntervalMonths: 12,
  securedByAccountId: null, valueLow: null, valueHigh: null, canDelete: false,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'new-1' }), { status: 200 })));
});

describe('AddItemSheet', () => {
  it('shows the hint that prevents the wrong life-insurance number', () => {
    render(<AddItemSheet side="asset" existingAssets={[]} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    fireEvent.change(screen.getByLabelText('Search items'), { target: { value: 'life insurance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Life insurance cash value' }));
    expect(screen.getByText(/cash surrender value, not the death benefit/i)).toBeInTheDocument();
  });

  it('offers existing property as security for a mortgage', () => {
    render(<AddItemSheet side="liability" existingAssets={[house]} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Mortgage' }));
    const select = screen.getByLabelText('Secured by') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toContain('Home');
  });

  it('warns before saving an item with no value', async () => {
    render(<AddItemSheet side="asset" existingAssets={[]} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Car' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Second car' } });
    expect(screen.getByText(/won.t count toward your net worth until you value it/i)).toBeInTheDocument();
  });

  it('posts the catalog key, name and value', async () => {
    const onCreated = vi.fn();
    render(<AddItemSheet side="asset" existingAssets={[]} onCreated={onCreated} />);
    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Car' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Civic' } });
    fireEvent.change(screen.getByLabelText('Current value'), { target: { value: '25000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ catalogKey: 'car', name: 'Civic', value: 25000 });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/app/components/netWorth/__tests__/AddItemSheet.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Write the component**

```tsx
// app/src/app/components/netWorth/AddItemSheet.tsx
'use client';

import { useMemo, useState } from 'react';
import { CATALOG, catalogByKey, type CatalogItem } from '@/lib/netWorth/catalog';
import { notifyDataChanged } from '@/lib/dataEvents';
import type { RegisterRow } from '@/app/net-worth/page';

interface Props {
  side: 'asset' | 'liability';
  existingAssets: RegisterRow[];
  onCreated: () => void;
}

export default function AddItemSheet({ side, existingAssets, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<CatalogItem | null>(null);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [securedBy, setSecuredBy] = useState('');
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(
    () => CATALOG.filter((c) => c.side === side && c.label.toLowerCase().includes(query.toLowerCase())),
    [side, query]);

  const securityOptions = picked?.securedByGroup
    ? existingAssets.filter((a) => a.group === picked.securedByGroup)
    : [];

  function reset() {
    setOpen(false); setQuery(''); setPicked(null);
    setName(''); setValue(''); setSecuredBy(''); setError(null);
  }

  async function save() {
    if (!picked) return;
    if (name.trim() === '') { setError('Give it a name.'); return; }
    const parsed = value.trim() === '' ? null : Number(value.replace(/[$,\s]/g, ''));
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setError('Enter a positive amount, or leave it blank to value it later.');
      return;
    }
    try {
      const res = await fetch('/api/net-worth/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          catalogKey: picked.key, name: name.trim(), value: parsed,
          securedByAccountId: securedBy || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
      }
      notifyDataChanged();
      onCreated();
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the item.');
    }
  }

  if (!open) {
    return (
      <button type="button" className="origin-btn origin-btn-secondary" onClick={() => setOpen(true)}>
        + Add item
      </button>
    );
  }

  return (
    <div className="origin-card p-[var(--space-4)] space-y-[var(--space-3)]">
      {!picked ? (
        <>
          <label htmlFor="nw-search" className="text-small text-[var(--color-text-base-subdued)]">Search items</label>
          <input id="nw-search" aria-label="Search items" className="origin-input w-full"
            value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <div className="flex flex-wrap gap-[var(--space-2)]">
            {matches.map((c) => (
              <button key={c.key} type="button" className="origin-btn origin-btn-secondary"
                onClick={() => { setPicked(c); setName(c.label); }}>
                {c.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="text-small text-[var(--color-text-base-default)]">{picked.label}</p>

          <label htmlFor="nw-name" className="text-small text-[var(--color-text-base-subdued)]">Name</label>
          <input id="nw-name" aria-label="Name" className="origin-input w-full"
            value={name} onChange={(e) => setName(e.target.value)} />

          <label htmlFor="nw-value" className="text-small text-[var(--color-text-base-subdued)]">Current value</label>
          <input id="nw-value" aria-label="Current value" className="origin-input w-full" inputMode="decimal"
            value={value} onChange={(e) => setValue(e.target.value)} />
          {picked.hint && (
            <p className="text-xsmall text-[var(--color-text-base-subdued)]">{picked.hint}</p>
          )}
          {value.trim() === '' && (
            /* Said before saving, not after. An unvalued item is allowed but it
               lands in the exclusion banner, and that should not be a surprise. */
            <p className="text-xsmall text-[var(--color-text-warning)]">
              This won&apos;t count toward your net worth until you value it.
            </p>
          )}

          {picked.securedByGroup && (
            <>
              <label htmlFor="nw-secured" className="text-small text-[var(--color-text-base-subdued)]">Secured by</label>
              <select id="nw-secured" aria-label="Secured by" className="origin-select w-full"
                value={securedBy} onChange={(e) => setSecuredBy(e.target.value)}>
                <option value="">Nothing</option>
                {securityOptions.map((a) => (
                  <option key={a.accountId} value={a.accountId}>{a.name}</option>
                ))}
              </select>
            </>
          )}

          {error && <p className="text-xsmall text-[var(--color-text-critical)]">{error}</p>}

          <div className="flex gap-[var(--space-2)]">
            <button type="button" className="origin-btn origin-btn-primary" onClick={() => { void save(); }}>Save</button>
            <button type="button" className="origin-btn origin-btn-secondary" onClick={reset}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the remove control to each register row**

In `BalanceSheet.tsx`'s `Row`, add beside the value input:

```tsx
<button
  type="button"
  className="origin-btn origin-btn-secondary"
  aria-label={`Remove ${row.name}`}
  onClick={() => { void remove(); }}
>
  {row.canDelete ? 'Delete' : 'Close'}
</button>
```

and in the same component:

```tsx
  async function remove() {
    // Two verbs, deliberately. Deleting an item that has recorded values would
    // rewrite past periods on the trend chart — "I sold my car" must not erase a
    // year of history. Once anything is recorded, the only removal is a close.
    const closing = !row.canDelete;
    const message = closing
      ? `Close ${row.name}? It stops counting from this month, and past months keep its value.`
      : `Delete ${row.name}? It has no recorded values, so nothing is lost.`;
    if (!window.confirm(message)) return;
    const res = closing
      ? await fetch(`/api/net-worth/accounts/${row.accountId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ closedAtMonth: new Date().toISOString().slice(0, 7) }),
        })
      : await fetch(`/api/net-worth/accounts/${row.accountId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === 'string' ? body.error : 'Could not remove the item.');
      return;
    }
    notifyDataChanged();
    onChanged();
  }
```

- [ ] **Step 5: Add the commonly-missed nudge (spec §6.5)**

Create `app/src/app/components/netWorth/MissedItemsHint.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { catalogByKey } from '@/lib/netWorth/catalog';
import type { RegisterRow } from '@/app/net-worth/page';

const DISMISS_KEY = 'wealthwise:networth:missed-hint-dismissed';

/**
 * Catalog items most households hold. Omitted DEBTS are the main reason a
 * computed net worth reads too optimistic, which is why three of these five are
 * liabilities rather than assets.
 */
const WATCH = ['hsa', 'five_two_nine', 'life_insurance_cash_value', 'heloc', 'student_loan'];

export default function MissedItemsHint({ rows }: { rows: RegisterRow[] }) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // Read in an effect, not during render: localStorage is unavailable during
    // SSR and would break hydration.
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  const missing = WATCH
    .map((k) => catalogByKey(k))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .filter((c) => !rows.some((r) => r.name.toLowerCase().includes(c.label.toLowerCase())));

  if (dismissed || missing.length === 0) return null;

  function dismiss() {
    try { window.localStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode: hide for this session only */ }
    setDismissed(true);
  }

  return (
    <div className="origin-card p-[var(--space-3)] flex items-start justify-between gap-[var(--space-3)]">
      <div>
        <p className="text-small text-[var(--color-text-base-default)]">Commonly missed</p>
        <p className="text-xsmall text-[var(--color-text-base-subdued)]">
          People often forget these: {missing.map((c) => c.label).join(', ')}. Add any you hold.
        </p>
      </div>
      <button type="button" className="origin-btn origin-btn-ghost" onClick={dismiss}>Dismiss</button>
    </div>
  );
}
```

Add a test asserting it renders nothing once dismissed and nothing when every watched item is already present:

```tsx
// app/src/app/components/netWorth/__tests__/MissedItemsHint.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MissedItemsHint from '@/app/components/netWorth/MissedItemsHint';
import type { RegisterRow } from '@/app/net-worth/page';

const row = (name: string): RegisterRow => ({
  accountId: name, name, side: 'asset', group: 'other', value: 1, lastAsOf: '2026-08-01',
  source: 'manual', reviewIntervalMonths: null, securedByAccountId: null,
  valueLow: null, valueHigh: null, canDelete: false,
});

beforeEach(() => window.localStorage.clear());

describe('MissedItemsHint', () => {
  it('names items the user has not added', async () => {
    render(<MissedItemsHint rows={[]} />);
    expect(await screen.findByText(/HSA/)).toBeInTheDocument();
  });

  it('stays dismissed once dismissed', async () => {
    const { unmount } = render(<MissedItemsHint rows={[]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    unmount();
    render(<MissedItemsHint rows={[]} />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });

  it('drops an item the user already tracks', async () => {
    render(<MissedItemsHint rows={[row('HSA')]} />);
    expect(await screen.findByText(/Commonly missed/)).toBeInTheDocument();
    expect(screen.queryByText(/HSA/)).not.toBeInTheDocument();
  });
});
```

Task 9 already mounts `MissedItemsHint`. **Do not edit `page.tsx`** — replace the stub's contents only.

Run: `cd app && npx vitest run src/app/components/netWorth/__tests__/MissedItemsHint.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Run the tests and verify they pass**

Run: `cd app && npx vitest run src/app/components/netWorth`
Expected: PASS — AddItemSheet 4, BalanceSheet 5, waterfall 3, MissedItemsHint 3.

- [ ] **Step 7: Wire the sheet into the register and commit**

Pass `<AddItemSheet side="asset" … />` and `<AddItemSheet side="liability" … />` into the two `Column` headers in `BalanceSheet.tsx`, with `existingAssets={rows.filter((r) => r.side === 'asset')}`. This edits `BalanceSheet.tsx`, not `page.tsx`.

```bash
cd app && npx tsc --noEmit && npm test
git add src/app/components/netWorth
git commit -m "feat(net-worth): add the catalog picker, with close and guarded delete"
```

---

### Task 14: Agent visibility

**Files:**
- Modify: `app/src/lib/agent/tools/read.ts`, `app/src/app/net-worth/page.tsx`
- Test: `app/src/lib/agent/tools/__tests__/netWorth.test.ts`

**Interfaces:**
- Consumes: `loadNetWorthContext`, `netWorthAt`, `staleAccounts`.
- Produces: a `net_worth` agent tool returning `{ net, assets, liabilities, missing, rows, stale }`, and a published `ViewSnapshot` for `/net-worth`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/agent/tools/__tests__/netWorth.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { createNetWorthAccount } from '@/lib/netWorth/write';
import { readNetWorth } from '@/lib/agent/tools/read';

describe('net_worth agent tool', () => {
  it('reports the current figure, its parts, and what is excluded', async () => {
    await createNetWorthAccount({ catalogKey: 'primary_residence', name: 'Home', value: 1_150_000 }, db);
    await createNetWorthAccount({ catalogKey: 'mortgage', name: 'Mortgage', value: 620_000 }, db);
    await createNetWorthAccount({ catalogKey: 'car', name: 'Second car' }, db);

    const out = await readNetWorth();
    expect(out.net).toBe(530_000);
    expect(out.assets).toBe(1_150_000);
    expect(out.liabilities).toBe(620_000);
    expect(out.missing).toEqual(['Second car']);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/lib/agent/tools/__tests__/netWorth.test.ts`
Expected: FAIL — `readNetWorth` is not exported.

- [ ] **Step 3: Add `readNetWorth` and register the tool**

In `app/src/lib/agent/tools/read.ts`, following the shape of the existing reserve-balance tool:

```ts
import { loadNetWorthContext } from '@/lib/netWorth/read';
import { netWorthAt } from '@/lib/netWorth/rollup';
import { staleAccounts } from '@/lib/netWorth/staleness';
import { netWorthSide } from '@/lib/netWorth/side';
import { valuationAt } from '@/lib/netWorth/valuation';

export async function readNetWorth() {
  const ctx = await loadNetWorthContext();
  const today = new Date().toISOString().slice(0, 10);
  const totals = netWorthAt(ctx, today);
  return {
    net: totals.net,
    assets: totals.assets,
    liabilities: totals.liabilities,
    missing: totals.missing,
    rows: ctx.accounts
      .filter((a) => netWorthSide(a) !== 'excluded' && a.status !== 'closed')
      .map((a) => ({ name: a.name, side: netWorthSide(a), value: valuationAt(ctx, a.id, today) })),
    stale: staleAccounts(ctx, today).map((s) => ({ name: s.name, lastAsOf: s.lastAsOf })),
  };
}
```

Register it in the same tool array the reserve tool is registered in, with the description:

> "Report current net worth: total assets, total liabilities, the net figure, every tracked item with its value, which items have no value recorded yet, and which are past their review date. Values carry forward from each item's most recent reading."

- [ ] **Step 4: Publish the page's view snapshot**

This is the one later task that edits `page.tsx`. It runs in a wave of its own
alongside Task 9's output, never concurrently with Tasks 10–13.

In `app/src/app/net-worth/page.tsx`, mirroring the Investments page:

```tsx
  const viewSnapshot = useMemo(() => totals ? ({
    route: '/net-worth',
    label: 'Net worth',
    timeRange: PRESET_LABELS[preset],
    highlights: [
      { label: 'Net worth', value: formatCurrency(totals.net) },
      { label: 'Assets', value: formatCurrency(totals.assets) },
      { label: 'Liabilities', value: formatCurrency(totals.liabilities) },
    ],
  }) : null, [totals, preset]);
  usePublishViewContext(loading || error ? null : viewSnapshot);
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `cd app && npx vitest run src/lib/agent/tools/__tests__/netWorth.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd app && npx tsc --noEmit && npm test
git add src/lib/agent/tools/read.ts src/lib/agent/tools/__tests__/netWorth.test.ts src/app/net-worth/page.tsx
git commit -m "feat(net-worth): let the assistant read the balance sheet"
```

---

### Task 15: End-to-end

**Files:**
- Create: `app/e2e/net-worth.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// app/e2e/net-worth.spec.ts
import { test, expect } from '@playwright/test';

test('adding an item and typing a value updates net worth', async ({ page }) => {
  await page.goto('/net-worth');

  await page.getByRole('link', { name: 'Net worth' }).click();
  await page.getByRole('button', { name: /add item/i }).first().click();
  await page.getByLabel('Search items').fill('primary');
  await page.getByRole('button', { name: 'Primary residence' }).click();
  await page.getByLabel('Name').fill('Home');
  await page.getByLabel('Current value').fill('1150000');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByTestId('assets-total')).toContainText('1,150,000');

  const input = page.getByLabel('Value for Home');
  await input.fill('1200000');
  await input.press('Enter');

  await expect(page.getByTestId('assets-total')).toContainText('1,200,000');
});
```

- [ ] **Step 2: Run it**

Run: `cd app && npm run e2e -- net-worth.spec.ts`
Expected: PASS. If the run needs a seeded database, follow whatever fixture the existing specs in `app/e2e/` use rather than pointing at `data/app.db`.

- [ ] **Step 3: Commit**

```bash
git add app/e2e/net-worth.spec.ts
git commit -m "test(net-worth): cover adding an item and editing its value end to end"
```

---
## Phase 2 — Plaid balance auto-fill

### Task 16: Write balances during the existing sync

**Files:**
- Modify: `app/src/lib/plaid/sync.ts:53-57` (the account-provisioning loop)
- Test: `app/src/lib/plaid/__tests__/syncBalances.test.ts`

**Interfaces:**
- Consumes: `upsertBalanceSnapshot` from `@/lib/netWorth/write`.
- Produces: no new exports — `syncItem` gains a side effect.

`accountsGet` already runs on every sync and its `AccountBase.balances` payload is currently discarded. This task consumes what is already fetched; there is no new Plaid call and no new scope.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/plaid/__tests__/syncBalances.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { balanceSnapshots } from '@/db/schema';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { syncItem } from '@/lib/plaid/sync';

const account = (over: Record<string, unknown>) => ({
  account_id: 'p1', name: 'Card', official_name: null, mask: '1234',
  type: 'credit', subtype: 'credit card',
  balances: { current: 8400, available: null, limit: null, iso_currency_code: 'USD' },
  ...over,
});

function client(accounts: unknown[]) {
  return {
    accountsGet: vi.fn(async () => ({ data: { accounts } })),
    transactionsSync: vi.fn(async () => ({
      data: { added: [], modified: [], removed: [], next_cursor: 'c1', has_more: false },
    })),
  };
}

const item = {
  id: 'item-1', accessToken: 'enc', institutionName: 'Chase', owner: 'Alex',
  cursor: null, syncedThroughMonth: null,
} as never;

describe('sync writes balances', () => {
  it('records a positive magnitude for a credit card balance', async () => {
    await syncItem(item, { client: client([account({})]) } as never);
    const rows = db.select().from(balanceSnapshots).all();
    expect(rows).toHaveLength(1);
    // Plaid reports card and loan balances as positive amounts owed. We store a
    // magnitude and derive direction from netWorthSide, so Math.abs is required
    // rather than cosmetic.
    expect(rows[0].balance).toBe(8400);
    expect(rows[0].source).toBe('plaid');
  });

  it('falls back to available when current is null', async () => {
    const { db: db2 } = makeTmpDb();
    void db2;
    await syncItem(item, {
      client: client([account({ account_id: 'p2', balances: { current: null, available: 1200 } })]),
    } as never);
    const row = db.select().from(balanceSnapshots).all().find((r) => r.balance === 1200);
    expect(row).toBeDefined();
  });

  it('writes no row when both current and available are null', async () => {
    const before = db.select().from(balanceSnapshots).all().length;
    await syncItem(item, {
      client: client([account({ account_id: 'p3', balances: { current: null, available: null } })]),
    } as never);
    expect(db.select().from(balanceSnapshots).all().length).toBe(before);
  });

  it('skips investment accounts, which syncInvestments already values', async () => {
    const before = db.select().from(balanceSnapshots).all().length;
    await syncItem(item, {
      client: client([account({ account_id: 'p4', type: 'investment', subtype: 'brokerage' })]),
    } as never);
    expect(db.select().from(balanceSnapshots).all().length).toBe(before);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/lib/plaid/__tests__/syncBalances.test.ts`
Expected: FAIL — no balance rows are written.

- [ ] **Step 3: Write the balance inside the existing loop**

In `app/src/lib/plaid/sync.ts`, extend the loop that already runs at line 53:

```ts
    const acctResp = await deps.client.accountsGet({ access_token: accessToken });
    for (const a of acctResp.data.accounts) {
      if (suppressed.has(a.account_id)) continue;
      const account = await resolveOrCreateAccount(
        { ...mapPlaidAccount(a, item.institutionName ?? 'Bank', item.owner), plaidItemId: item.id }, db);

      // Balance capture. accountsGet is already being called for provisioning —
      // this consumes a payload that was previously discarded, so there is no
      // extra request and no extra Plaid scope.
      //
      // Investment accounts are skipped: syncInvestments values those from
      // holdings, and investment_snapshots is the authoritative table for them.
      if (a.type !== 'investment' && a.type !== 'brokerage') {
        const raw = a.balances?.current ?? a.balances?.available ?? null;
        // A missing balance is not a zero balance. Some institutions report
        // neither figure, and writing 0 would silently wipe the account's value.
        if (raw !== null && raw !== undefined) {
          await upsertBalanceSnapshot({
            accountId: account.id,
            asOf: new Date().toISOString().slice(0, 10),
            // Plaid reports credit and loan balances as positive amounts owed;
            // we store magnitudes and derive sign from netWorthSide.
            balance: Math.abs(raw),
            source: 'plaid',
          }, db);
        }
      }
    }
```

Add the import at the top: `import { upsertBalanceSnapshot } from '@/lib/netWorth/write';`

- [ ] **Step 4: Clear the review cadence on Plaid-fed accounts**

A synced balance is not an estimate going stale, so it must never appear in the "needs a look" strip. In `app/src/lib/accounts.ts`'s `resolveOrCreateAccount`, when `input.origin === 'plaid'`, set `reviewIntervalMonths: null` on create. Add a test asserting a Plaid-origin account is absent from `staleAccounts` even with an old reading.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `cd app && npx vitest run src/lib/plaid src/lib/netWorth`
Expected: PASS, including the existing Plaid suite unchanged.

- [ ] **Step 6: Commit**

```bash
cd app && npx tsc --noEmit && npm test
git add src/lib/plaid/sync.ts src/lib/accounts.ts src/lib/plaid/__tests__/syncBalances.test.ts
git commit -m "feat(net-worth): capture Plaid account balances during the existing sync"
```

---

## Phase 3 — Optional automated property valuation

### Task 17: Provider interface and the RentCast implementation

**Files:**
- Create: `app/src/lib/netWorth/providers/index.ts`, `app/src/lib/netWorth/providers/rentcast.ts`
- Modify: `app/.env.example` (schema columns already exist from Task 1)
- Test: `app/src/lib/netWorth/__tests__/providers.test.ts`

**Interfaces:**
- Produces:
  - `interface Estimate { value: number; low: number | null; high: number | null }`
  - `interface ValuationProvider { key: string; supports(subtype: string): boolean; estimate(ref: string): Promise<Estimate> }`
  - `getValuationProvider(): ValuationProvider | null`
  - `accounts.valuationProvider` (`text | null`), `accounts.valuationRef` (`text | null`)

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/netWorth/__tests__/providers.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getValuationProvider } from '@/lib/netWorth/providers';
import { makeRentcastProvider } from '@/lib/netWorth/providers/rentcast';

const OLD = process.env.RENTCAST_API_KEY;
afterEach(() => { process.env.RENTCAST_API_KEY = OLD; vi.unstubAllGlobals(); });

describe('getValuationProvider', () => {
  it('returns null when no key is configured', () => {
    delete process.env.RENTCAST_API_KEY;
    expect(getValuationProvider()).toBeNull();
  });

  it('returns the RentCast provider when a key is set', () => {
    process.env.RENTCAST_API_KEY = 'k';
    expect(getValuationProvider()?.key).toBe('rentcast');
  });
});

describe('rentcast provider', () => {
  beforeEach(() => { process.env.RENTCAST_API_KEY = 'k'; });

  it('supports real estate only', () => {
    const p = makeRentcastProvider('k');
    expect(p.supports('real_estate')).toBe(true);
    expect(p.supports('vehicle')).toBe(false);
  });

  it('returns the point value and its range', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ price: 1_150_000, priceRangeLow: 1_090_000, priceRangeHigh: 1_210_000 }),
      { status: 200 })));
    const out = await makeRentcastProvider('k').estimate('1 Main St, Springfield, IL');
    expect(out).toEqual({ value: 1_150_000, low: 1_090_000, high: 1_210_000 });
  });

  it('throws on a non-2xx rather than returning a zero', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 429 })));
    await expect(makeRentcastProvider('k').estimate('x')).rejects.toThrow(/429/);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/providers.test.ts`
Expected: FAIL — cannot resolve `@/lib/netWorth/providers`.

- [ ] **Step 3: Write the provider**

```ts
// app/src/lib/netWorth/providers/rentcast.ts
export interface Estimate { value: number; low: number | null; high: number | null }

export interface ValuationProvider {
  key: string;
  supports(subtype: string): boolean;
  estimate(ref: string): Promise<Estimate>;
}

/**
 * RentCast AVM lookup.
 *
 * Chosen over Zillow because Zillow's public Zestimate API was retired in 2021
 * and its only official replacement is MLS-gated; the wrapper services that
 * resell Zestimates scrape against Zillow's terms. RentCast is self-serve, its
 * free tier is 50 requests/month, and its licensing permits consumer apps.
 *
 * Never returns a fallback value. A failed lookup throws, so the caller writes
 * nothing and the property stays in the stale list — a silent failure that
 * leaves a stale value looking current is the worst outcome available here.
 */
export function makeRentcastProvider(apiKey: string): ValuationProvider {
  return {
    key: 'rentcast',
    supports: (subtype) => subtype === 'real_estate',
    async estimate(ref: string): Promise<Estimate> {
      const url = `https://api.rentcast.io/v1/avm/value?address=${encodeURIComponent(ref)}`;
      const res = await fetch(url, { headers: { 'X-Api-Key': apiKey, accept: 'application/json' } });
      if (!res.ok) throw new Error(`RentCast returned HTTP ${res.status}`);
      const body = await res.json() as {
        price?: number; priceRangeLow?: number; priceRangeHigh?: number;
      };
      if (typeof body.price !== 'number' || !Number.isFinite(body.price)) {
        throw new Error('RentCast returned no usable price');
      }
      return {
        value: body.price,
        low: typeof body.priceRangeLow === 'number' ? body.priceRangeLow : null,
        high: typeof body.priceRangeHigh === 'number' ? body.priceRangeHigh : null,
      };
    },
  };
}
```

```ts
// app/src/lib/netWorth/providers/index.ts
import { makeRentcastProvider, type ValuationProvider } from '@/lib/netWorth/providers/rentcast';

export type { ValuationProvider, Estimate } from '@/lib/netWorth/providers/rentcast';

/**
 * The configured provider, or null.
 *
 * 'manual' is not a provider — it is the absence of one, and it is the default
 * for every account. Every call site must handle null, exactly as the Plaid
 * paths handle absent Plaid config.
 */
export function getValuationProvider(): ValuationProvider | null {
  const key = process.env.RENTCAST_API_KEY;
  return key ? makeRentcastProvider(key) : null;
}
```

- [ ] **Step 4: Document the env var**

`accounts.valuationProvider` and `accounts.valuationRef` already exist — Task 1
added every column for all three phases in one migration. **Do not modify
`schema.ts`.**

In `app/.env.example`, add:

```
# Optional. Enables automated property valuation on the Net worth page.
# Free tier is 50 requests/month: https://developers.rentcast.io
# Setting this sends the addresses you opt in per property to RentCast.
RENTCAST_API_KEY=
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `cd app && npx vitest run src/lib/netWorth/__tests__/providers.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
cd app && npx tsc --noEmit && npm test
git add src/lib/netWorth/providers .env.example
git commit -m "feat(net-worth): add an optional valuation provider interface with RentCast"
```

---

### Task 18: Refresh endpoint, rate guard, UI, and the README correction

**Files:**
- Create: `app/src/app/api/net-worth/estimate/route.ts`
- Modify: `app/src/app/components/netWorth/BalanceSheet.tsx`, `README.md`
- Test: `app/src/app/api/net-worth/__tests__/estimate.test.ts`

**Interfaces:**
- Consumes: `getValuationProvider`, `upsertBalanceSnapshot`.
- Produces: `POST /api/net-worth/estimate { accountId }` → `{ ok: true, value, low, high }`, `409` when already refreshed today, `404` when no provider is configured.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/app/api/net-worth/__tests__/estimate.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { eq } from 'drizzle-orm';
import { accounts, balanceSnapshots } from '@/db/schema';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { POST } from '../estimate/route';
import { createNetWorthAccount, upsertBalanceSnapshot } from '@/lib/netWorth/write';

afterEach(() => { vi.unstubAllGlobals(); delete process.env.RENTCAST_API_KEY; });

const req = (accountId: string) => new Request('http://t/api/net-worth/estimate', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ accountId }),
}) as never;

async function house(address = '1 Main St') {
  const id = await createNetWorthAccount({ catalogKey: 'primary_residence', name: 'Home' }, db);
  db.update(accounts).set({ valuationProvider: 'rentcast', valuationRef: address })
    .where(eq(accounts.id, id)).run();
  return id;
}

describe('POST /api/net-worth/estimate', () => {
  it('404s when no provider is configured', async () => {
    const id = await house();
    expect((await POST(req(id))).status).toBe(404);
  });

  it('stores the value and its range', async () => {
    process.env.RENTCAST_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ price: 1_150_000, priceRangeLow: 1_090_000, priceRangeHigh: 1_210_000 }),
      { status: 200 })));
    const id = await house('2 Main St');
    expect((await POST(req(id))).status).toBe(200);
    const row = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).get();
    expect(row?.balance).toBe(1_150_000);
    expect(row?.valueLow).toBe(1_090_000);
    expect(row?.source).toBe('estimate');
  });

  it('refuses a second refresh on the same day, protecting the free-tier quota', async () => {
    process.env.RENTCAST_API_KEY = 'k';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ price: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await house('3 Main St');
    await POST(req(id));
    expect((await POST(req(id))).status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the provider fails, leaving the item stale', async () => {
    process.env.RENTCAST_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const id = await house('4 Main St');
    expect((await POST(req(id))).status).toBe(502);
    expect(db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).all()).toHaveLength(0);
  });

  it('never overwrites a manual value entered the same day', async () => {
    process.env.RENTCAST_API_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ price: 999 }), { status: 200 })));
    const id = await house('5 Main St');
    const today = new Date().toISOString().slice(0, 10);
    await upsertBalanceSnapshot({ accountId: id, asOf: today, balance: 1_150_000, source: 'manual' }, db);
    await POST(req(id));
    const row = db.select().from(balanceSnapshots).where(eq(balanceSnapshots.accountId, id)).get();
    expect(row?.balance).toBe(1_150_000);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app && npx vitest run src/app/api/net-worth/__tests__/estimate.test.ts`
Expected: FAIL — cannot resolve `../estimate/route`.

- [ ] **Step 3: Write the route**

```ts
// app/src/app/api/net-worth/estimate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { accounts, balanceSnapshots } from '@/db/schema';
import { getValuationProvider } from '@/lib/netWorth/providers';
import { upsertBalanceSnapshot } from '@/lib/netWorth/write';

export async function POST(request: NextRequest) {
  const db = getDb();
  try {
    const { accountId } = await request.json() as { accountId?: string };
    if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });

    const provider = getValuationProvider();
    if (!provider) {
      return NextResponse.json(
        { error: 'No valuation provider is configured. Set RENTCAST_API_KEY to enable this.' },
        { status: 404 });
    }

    const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!account?.valuationRef) {
      return NextResponse.json({ error: 'This item has no address to look up.' }, { status: 400 });
    }
    if (!provider.supports(account.subtype ?? '')) {
      return NextResponse.json({ error: 'This provider cannot value this kind of item.' }, { status: 400 });
    }

    // Rate guard, checked BEFORE the call. Free tiers are small, and this guard
    // is the only thing between a refresh loop and a burned monthly quota.
    const today = new Date().toISOString().slice(0, 10);
    const already = db.select().from(balanceSnapshots)
      .where(and(eq(balanceSnapshots.accountId, accountId), eq(balanceSnapshots.asOf, today)))
      .get();
    if (already && already.source === 'estimate') {
      return NextResponse.json({ error: 'Already refreshed today.' }, { status: 409 });
    }

    let estimate;
    try {
      estimate = await provider.estimate(account.valuationRef);
    } catch (err) {
      // Deliberately write nothing. The item stays in the stale list rather than
      // showing a carried-forward value as if it had just been refreshed.
      console.error('Valuation provider failed:', err);
      return NextResponse.json({ error: 'The valuation service did not respond.' }, { status: 502 });
    }

    // upsertBalanceSnapshot itself refuses to replace a same-day manual row.
    await upsertBalanceSnapshot({
      accountId, asOf: today, balance: estimate.value, source: 'estimate',
      valueLow: estimate.low, valueHigh: estimate.high,
    }, db);

    return NextResponse.json({ ok: true, ...estimate });
  } catch (error) {
    console.error('Error refreshing estimate:', error);
    return NextResponse.json({ error: 'Failed to refresh the estimate' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Surface it in the register**

In `BalanceSheet.tsx`'s `Row`, when `row.source === 'estimate'` show the range beside the value:

```tsx
{row.source === 'estimate' && row.valueLow !== null && row.valueHigh !== null && (
  /* An AVM is a range, not a measurement. Showing only the midpoint beside a
     typed figure would present a model output as fact. */
  <span className="text-xsmall text-[var(--color-text-base-subdued)]"
    title={`Estimated range ${formatCurrency(row.valueLow)} – ${formatCurrency(row.valueHigh)}`}>
    est.
  </span>
)}
```

and add the refresh control, rendered only for property rows:

```tsx
{row.group === 'property' && (
  <button
    type="button"
    className="origin-btn origin-btn-ghost"
    aria-label={`Refresh estimate for ${row.name}`}
    disabled={saving}
    onClick={() => { void refreshEstimate(); }}
  >
    Refresh estimate
  </button>
)}
```

```tsx
  async function refreshEstimate() {
    setSaving(true);
    try {
      const res = await fetch('/api/net-worth/estimate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: row.accountId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 404 (no provider) and 409 (already refreshed today) are ordinary
        // outcomes, not faults — show what the server said and move on.
        setError(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
        return;
      }
      notifyDataChanged();
      onChanged();
    } catch {
      setError('Could not reach the valuation service.');
    } finally {
      setSaving(false);
    }
  }
```

Also extend `GET /api/net-worth` in `route.ts` to return the real `valueLow` / `valueHigh` from the latest snapshot rather than the hardcoded `null`s left in Task 8.

- [ ] **Step 5: Correct the README before this ships**

This is a release condition, not a nicety. In `README.md`, the sentence beginning *"All data stays on your own machine — nothing is sent to a third party except…"* must be amended to name RentCast and say that opting a property in sends its address. Add `RENTCAST_API_KEY` to the configuration table as optional, noting the 50-request free tier and that leaving it unset disables the feature entirely.

- [ ] **Step 6: Run everything and commit**

```bash
cd app && npx tsc --noEmit && npm test
git add src/app/api/net-worth src/app/components/netWorth/BalanceSheet.tsx ../README.md
git commit -m "feat(net-worth): add opt-in property valuation refresh with a daily rate guard"
```

---

## Done criteria

- `npm test` and `npx tsc --noEmit` clean.
- `npm run e2e -- net-worth.spec.ts` passes.
- A never-valued item appears in the exclusion banner and is **not** summed as zero anywhere.
- Closing an item leaves past periods on the trend chart unchanged; deleting one with history is refused with a 409.
- With `RENTCAST_API_KEY` unset, the app builds, runs, and the Net worth page never mentions estimates.
