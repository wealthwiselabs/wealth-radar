# Net Worth Tracking — Design

**Date:** 2026-08-30
**Status:** Approved design, pending implementation plan
**Phases:** 1 manual (shippable alone) · 2 Plaid balances · 3 optional auto-valuation
**Branch:** `claude/networth-tracking-ux-0c6613`

## Problem

The app has no balance sheet. It tracks **flows** (transactions) and **investment
valuations** (`investment_snapshots`), but it stores no balance for any spending or
liability account, and it has no model at all for assets that cannot be linked —
real estate, vehicles, an HSA, an IUL cash value.

Concretely, `grep -rn balance src/` returns only investment-window balances. Checking,
savings, and credit cards exist purely as transaction streams. There is no way to answer
"what am I worth, and is it going up?"

The household in question holds: a primary residence (with a mortgage), two cars (owned
outright today, but auto loans must be supported), an IUL cash value, an HSA, revolving
credit card debt, plus the cash and brokerage accounts the app already knows about.

## Decisions taken during design

| Question | Decision |
|---|---|
| Scope of the number | Everything — cash, cards, investments, manual assets, all loans. Plaid auto-fills what it can; the rest is manual. |
| Liabilities | A general model. Any liability may optionally be secured by an asset (mortgage → house, auto loan → car). |
| Staleness | Per-asset review cadence with a visible nudge. Values always carry forward; overdue ones surface in a list. Never blocks the number. |
| Storage | New `balance_snapshots` table. Everything stays an `accounts` row. |
| Sign | Balances stored as positive magnitudes. Sign derived, never stored. |
| Visuals | All three of trend, waterfall, and register — in that order, on one page. |
| Phasing | Both phases specced. Phase 1 manual-only is independently shippable. |
| Common items | A catalog of common line items, offered as a **picker**. Nothing is created until the user picks it. |
| Removal | Two verbs: **close** (preserves history) and **delete** (only for never-valued items). |
| Auto-valuation | Phase 3: a provider interface with RentCast as the first optional, BYO-key implementation. Property only; vehicles stay manual. |

## Current architecture (as-is)

```
accounts (id, name, institution, mask, owner, accountClass, purpose,
          type, subtype, origin, plaidAccountId, status, closedAtMonth, …)
   │
   ├── transactions ────────▶ monthly_aggregates      (flows; Home page)
   │
   └── investment_snapshots (accountId, asOf, month, totalValue,
                             holdingsComplete, source)
          └── snapshot_holdings ──▶ securities        (Investments page)
```

Load-bearing facts this design depends on:

- `accounts.accountClass` is already `spending | investment | liability`
  (`app/src/db/schema.ts:10`).
- `accounts.subtype`, `status`, and `closedAtMonth` already exist — selling a car is a
  close, not a delete.
- **Carry-forward is already a deliberate, named concept.** `householdValueAt`
  (`app/src/lib/investments/allocation.ts:768`) sums each account's latest snapshot
  carried forward to an arbitrary `asOf`, and `periods.ts:138` exposes a `carryForward`
  flag. This design reuses that rule rather than inventing a second one.
- **The IUL already exists** as an `insurance`-purpose investment account
  (`app/src/lib/investments/purpose.ts:11`) — counted in net worth, excluded from ROI.
  It must be attached to, never duplicated.
- **`accountsGet` already runs on every Plaid sync** (`app/src/lib/plaid/sync.ts:53`) and
  its `AccountBase.balances` payload is currently discarded. Phase 2 consumes what is
  already fetched.
- Plaid credit cards map to `accountClass: 'spending'`
  (`app/src/lib/plaid/mapAccount.ts:21`), and that classification drives the Home
  spending charts. **It must not be changed.**
- The Reserve page establishes the precedent for a range-independent "current balance"
  figure sitting beside range-dependent charts (`app/src/app/investments/reserve/page.tsx:65`).
- The codebase's standing rule: an unknown total renders as an em dash, **never `$0`**
  (`app/src/app/components/investments/PurposeTiles.tsx`).

## Approach (chosen: "new snapshot table, everything stays an account")

Rejected alternatives:

- **Generalize `investment_snapshots` into one `valuations` table.** One carry-forward
  path and no union, but that table underpins returns, ROI, the allocation tree,
  statement backfill, purpose splitting, and the agent read tools. It also overloads
  `holdingsComplete: false`, which today means "the breakdown is unknown" — a different
  claim from "a house has no breakdown." The migration risk outweighs the elegance.
- **Standalone `assets` / `liabilities` tables outside `accounts`.** Conceptually clean
  (a house has no mask and no Plaid identity), but it duplicates lifecycle logic, needs a
  second editing surface, and collapses on the fact that the mortgage and the credit
  cards genuinely *are* Plaid accounts. They would straddle both models.

## Design

### 1. Schema (`app/src/db/schema.ts`)

New table, deliberately mirroring `investment_snapshots` so the two read alike:

```ts
export const balanceSnapshots = sqliteTable('balance_snapshots', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  asOf: text('as_of').notNull(),                 // YYYY-MM-DD
  month: text('month').notNull(),                // YYYY-MM
  // Positive magnitude ALWAYS. A liability of $8,400 is stored as 8400, not -8400:
  // that is how the statement reads, and a sign-flip bug in a rollup is silent.
  // Direction comes from netWorthSide(account) at read time.
  balance: real('balance').notNull().default(0),
  source: text('source').notNull().default('manual'), // plaid | manual | statement
  note: text('note').notNull().default(''),
  createdAt: text('created_at').notNull(),
  modifiedAt: text('modified_at').notNull(),
}, (t) => ({
  uniq: unique('balsnap_account_asof').on(t.accountId, t.asOf),
  byMonth: index('balsnap_month').on(t.month),
}));
```

Additions to `accounts`:

- `accountClass` gains a fourth value: `asset`. Used for things that are neither spent
  from nor invested in — real estate, vehicles, a cash-only HSA.
- `reviewIntervalMonths INTEGER NULL` — the per-asset refresh cadence. `NULL` means never
  nag (correct for every Plaid-fed account).
- `securedByAccountId TEXT NULL` — a liability may point at the asset securing it.
  Mortgage → house, auto loan → car. Nullable and unenforced beyond the FK; a credit card
  points at nothing.

`subtype` carries `real_estate | vehicle | hsa` for `asset`-class rows. No new column.

An HSA that actually holds securities should be an `investment`-class account with
`investment_snapshots` instead. The schema supports either; it is a per-account choice at
setup, not a schema decision.

### 2. Sign derivation (`app/src/lib/netWorth/side.ts`)

A pure function, because the Plaid credit-card classification cannot be changed:

```ts
export type Side = 'asset' | 'liability' | 'excluded';

export function netWorthSide(a: Pick<Account, 'accountClass' | 'type'>): Side
```

Rules, in order:

1. `accountClass === 'liability'` → `liability`
2. `accountClass === 'spending' && type === 'credit'` → `liability`
3. `accountClass === 'spending'` → `asset`  (checking, savings)
4. `accountClass === 'investment' | 'asset'` → `asset`

Rule 2 is the load-bearing one and exists solely so `mapAccount.ts` and the Home spending
charts stay untouched. It gets its own test.

### 3. Valuation and rollup (`app/src/lib/netWorth/`)

- `valuationAt(ctx, accountId, date): number | null`
  Latest `balance_snapshots` row at or before `date`; falls back to
  `investment_snapshots.totalValue` for investment accounts. Carried forward per the
  existing `householdValueAt` rule. `null` when the account has **no** snapshot at or
  before that date.

- `netWorthAt(ctx, date): { value: number; missing: string[] }`
  Σ assets − Σ liabilities over active accounts, sign from `netWorthSide`. Accounts
  returning `null` are **excluded from the sum and named in `missing`**.

- `netWorthSeries(ctx, from, to, basis)`
  `netWorthAt` over the `periods.ts` grid, returning per-period
  `{ date, assets: {liquid, illiquid}, liabilities, net, missing }`.

- `staleAccounts(ctx, asOf)`
  Accounts whose `reviewIntervalMonths` is non-null and whose newest snapshot is older
  than that interval. Returns `{ accountId, name, lastAsOf, monthsOverdue }`.

**Unknown-value policy.** This is the one place the design bends the "em dash, never $0"
rule, and it does so deliberately: an account with *no snapshot ever* is excluded from the
total and named in a banner ("Net worth excludes 2 accounts you haven't valued yet"). An
account with an *old* snapshot carries forward, per existing precedent. Nulling the entire
headline because one car was never valued would make the page useless, but the total must
never silently absorb an unknown as zero — hence the banner. `missing` is threaded all the
way to the UI.

### 4. API (`app/src/app/api/net-worth/`)

| Route | Returns |
|---|---|
| `GET /api/net-worth` | Current `netWorthAt(today)` + per-account rows for the register + `missing` |
| `GET /api/net-worth/series?from&to&basis` | `netWorthSeries` output for the trend chart |
| `GET /api/net-worth/stale` | `staleAccounts(today)` |
| `POST /api/net-worth/snapshot` | Upsert one `balance_snapshots` row `{ accountId, asOf, balance, note }` |
| `POST /api/net-worth/accounts` | Create a manual asset or liability account, optionally with its first snapshot in the same request |
| `PATCH /api/net-worth/accounts/:id` | Edit name, `reviewIntervalMonths`, `securedByAccountId`; set `status: 'closed'` + `closedAtMonth` |
| `DELETE /api/net-worth/accounts/:id` | Hard delete. **Refuses with 409 if the account has any snapshot** — close it instead |

`POST /snapshot` defaults `asOf` to today and upserts on `(accountId, asOf)`, so repeated
edits on the same day correct that day's reading rather than accumulating rows.

Every mutation calls `notifyDataChanged()` so open pages refresh, matching the existing
convention.

### 5. Page (`app/src/app/net-worth/page.tsx`)

New top-level route. `AppHeader.NAV` gains `{ href: '/net-worth', label: 'Net worth' }`
in slot 2, directly after Home — the NAV comment orders by visit frequency, and the
balance sheet outranks Investments. Home stays cash-flow; it gains a small net worth stat
linking here, nothing more.

Sections top to bottom:

1. **Hero** — the figure, plus Δ over the selected range. `TimeRangeDropdown` +
   `useTimeRange`, same as Investments. `missing.length > 0` renders the exclusion banner
   directly beneath.

2. **Trend chart** (`NetWorthChart.tsx`) — stacked bars on a single y-axis: assets above
   zero split into *cash & investments* / *property, cars, HSA, IUL*, liabilities below
   zero, net worth as a 2px line through the whole thing with an end-dot. Chart.js via
   the shared `chartConfig`. Putting debt below the baseline rather than netting it into
   one number is the point of the visual: an $800k house against a $500k mortgage must not
   read like an $800k asset.

3. **Waterfall** (`NetWorthWaterfall.tsx`) — today only, range-independent, following the
   Reserve tile precedent. Steps through *cash → investments → property → other assets →
   mortgage → other loans → cards → net worth* rather than a single "assets" bar, so it
   stays informative for a household with few liabilities.

4. **Needs a look** (`StaleStrip.tsx`) — overdue assets from `/stale`, each with an inline
   value field. Renders nothing when the list is empty.

5. **Register** (`BalanceSheet.tsx`) — assets and liabilities in two columns, every row
   showing name, current value, and an as-of age badge that turns warning-colored past the
   review interval. A liability with `securedByAccountId` renders indented under its asset
   with the derived equity beside it.

**The critical interaction:** updating a value is typing a number into the row and
pressing enter — one `POST /snapshot` dated today. No modal, no wizard. A separate
"backdate" affordance on the row opens a date field for entering an old statement value.
If this takes more than a couple of seconds the feature dies of neglect, and every other
decision here is downstream of that.

Charts follow the `dataviz` conventions already in use: one y-axis, fixed categorical hue
order, a legend whenever two or more series are present, 2px surface gaps between stacked
segments, and a validated palette in both light and dark mode.

### 6. Item catalog, add and remove

Manual tracking fails two ways: people cannot think of everything they own, and they
mistype the classification of what they do think of. A catalog of common line items fixes
both — but it must be a **picker, not a pre-populated list**.

Seeding a new install with twenty zero-value rows would contradict §3 directly: a missing
snapshot is not a zero, so all twenty would land in `missing[]` and the exclusion banner
would announce eighteen unvalued accounts on an empty database. Nothing is created until
the user picks it.

#### 6.1 The catalog (`app/src/lib/netWorth/catalog.ts`)

A static, typed array — data, not a table. Each entry is a template that pre-fills the
account it creates:

```ts
export interface CatalogItem {
  key: string;                    // 'primary_residence'
  label: string;                  // 'Primary residence'
  group: 'cash' | 'investments' | 'property' | 'vehicles' | 'other' | 'debt';
  side: 'asset' | 'liability';
  accountClass: 'asset' | 'investment' | 'spending' | 'liability';
  subtype: string;
  reviewIntervalMonths: number | null;
  securedByGroup?: 'property' | 'vehicles' | 'other';  // liabilities only
  hint?: string;                  // shown under the field in the add sheet
}
```

**Assets**

| Group | Items | Class | Review |
|---|---|---|---|
| Cash | Checking, Savings, CD, Money market, Cash on hand | `spending` | 1 mo |
| Investments | Brokerage, 401(k)/403(b), Traditional IRA, Roth IRA, HSA, 529, Crypto, Pension | `investment` | 3 mo |
| Property | Primary residence, Rental property, Land | `asset` | 12 mo |
| Vehicles | Car, Motorcycle, Boat, RV | `asset` | 12 mo |
| Other | Life insurance cash value, Business equity, Collectibles / art / jewelry, Other asset | `asset` | 12 mo |

**Liabilities** — all `accountClass: 'liability'`, review `null` (a loan balance is not an
estimate; it is either synced or entered from a statement):

Mortgage *(secured by property)*, HELOC *(property)*, Auto loan *(vehicles)*, Student
loan, Credit card, Personal loan, 401(k) loan, Policy loan *(other)*, Medical debt, Taxes
owed, Other liability.

#### 6.2 Hints that prevent wrong numbers

Three catalog entries carry a `hint` because the obvious value is the wrong one. These are
the highest-value part of the catalog and are not decoration:

- **Life insurance cash value** — "Enter the cash surrender value, not the death benefit."
  Directly relevant: the household's IUL is already tracked, and the death benefit is the
  figure the statement leads with.
- **Pension** — "Only include this if your plan reports a lump-sum or present-value
  figure." Otherwise it is unknowable and belongs out of the total, not in it at a guess.
- **401(k)/403(b) and Traditional IRA** — "Counted at full balance; deferred income tax is
  not modeled." Net worth here is pre-tax, and saying so once beats a wrong mental model.

#### 6.3 Add flow (`AddItemSheet.tsx`)

`+ Add item` sits at the head of each register column. The sheet is:

1. A search field over catalog labels, with the groups listed beneath it.
2. Picking an item pre-fills class, subtype, and review interval; the user types a **name**
   and a **starting value**, and nothing else is required.
3. A liability whose `securedByGroup` is set shows a "Secured by" dropdown listing existing
   accounts in that group, plus "Nothing" — so a mortgage offers the house and an auto loan
   offers the cars.
4. Save creates the account **and** its first `balance_snapshots` row in one request.
   Creating an item without a value is allowed but immediately puts it in `missing[]`, and
   the sheet says so before saving.

An "Add custom item" escape hatch at the bottom exposes the raw fields for anything the
catalog does not cover.

#### 6.4 Remove is two verbs

`accounts` already has `status` and `closedAtMonth`, so removal must not be one button:

- **Close** — you sold the car or paid off the loan. Sets `status: 'closed'` and
  `closedAtMonth`. It drops out of current net worth but **its history stays**, so past
  periods on the trend chart remain correct. This is the default, and the only option once
  an item has any snapshot.
- **Delete** — added by mistake. Hard-deletes the account and its snapshots. Offered
  **only when the item has zero snapshots**, so it can never silently rewrite the trend.

Conflating these would let "I sold my car" retroactively erase a year of net worth
history. The confirm dialog names which one is happening and what it does to past periods.

#### 6.5 Commonly-missed nudge

A dismissible one-time hint under the register lists catalog items the user has not added
that most people hold — HSA, 529, life insurance cash value, HELOC, student loans. Research
consistently finds omitted debts are the main reason a computed net worth reads too
optimistic. It is a hint, not a nag: dismissed once, never shown again, and it never
appears in the stale list.

References consulted for the catalog and the hints:
[U.S. News on what to include and leave out](https://money.usnews.com/money/personal-finance/family-finance/articles/what-you-should-include-in-your-net-worth-and-what-you-should-leave-out),
[Monarch's net worth tracking guide](https://www.monarch.com/blog/personal-finance/net-worth-tracking-guide),
[Monarch manual account types](https://help.monarch.com/hc/en-us/articles/360058187072-Manual-Accounts),
[Ohio State Extension, preparing a net worth statement](https://ohioline.osu.edu/factsheet/hyg-5245),
[Britannica Money, personal balance sheet](https://www.britannica.com/money/personal-balance-sheet).

### 7. Agent visibility

`usePublishViewContext` publishes route, time range, and highlights (net worth, total
assets, total liabilities), consistent with the Investments page. A `net_worth` read tool
in `app/src/lib/agent/tools/read.ts` returns the current figure, the register rows, and
the stale list, so the assistant can answer balance-sheet questions.

### 8. Phase 2 — Plaid balances

`sync.ts:53` already fetches every account via `accountsGet`; `AccountBase.balances`
is in hand and discarded. Phase 2 writes it:

```
for (const a of acctResp.data.accounts) {
  … existing resolveOrCreateAccount …
  upsert balance_snapshots {
    accountId, asOf: today, source: 'plaid',
    balance: Math.abs(a.balances.current ?? a.balances.available ?? 0)
  }
}
```

Notes:

- `Math.abs` is required: Plaid reports credit and loan balances as positive owed amounts,
  but the sign convention here is "magnitude only, direction from `netWorthSide`."
- Accounts in the `suppressed` set are skipped, exactly as they are for provisioning.
- `balances.current` is null for some institutions; fall back to `available`, and if both
  are null write **no row** rather than a zero. A missing balance is not a zero balance.
- One row per account per day via the `(accountId, asOf)` upsert, so syncing five times a
  day does not create five rows.
- Phase 2 sets `reviewIntervalMonths = NULL` on Plaid-fed accounts so they never appear in
  the stale list.

Phase 1 is correct and shippable without any of this; Phase 2 only removes typing.

### 9. Phase 3 — automated property valuation (optional)

Optional, off by default, and structured as a **provider interface** rather than a
vendor integration. This mirrors Plaid's treatment in this codebase: absent config means
the feature simply does not exist, and everything else still works.

#### 9.1 Why RentCast, and why not the others

| Provider | Verdict |
|---|---|
| Zillow Zestimate | **Unavailable.** Public API retired in 2021; the only official route is Bridge Interactive — MLS-membership gated, ~$500/mo, multi-week approval. |
| Zillow wrapper/scraper services | **Rejected.** They scrape Zillow against its terms. Not appropriate to ship in an OSS app. |
| ATTOM / Estated | ~$299/mo, enterprise sales. Estated is now part of ATTOM. Disproportionate. |
| **RentCast** | **Chosen.** Self-serve, 50 free requests/month, licensing explicitly permits consumer applications and internal data storage. One property refreshed quarterly is ~4 calls/year. |
| Vehicles (VinAudit, CarsXE, MarketCheck) | **Out of scope.** VinAudit is the best-documented and costs $100/mo base + $0.10/query for roughly 8 calls a year. KBB and Edmunds have no self-serve public API. NHTSA vPIC is free but decode-only — no values. |

#### 9.2 Provider interface (`app/src/lib/netWorth/providers/`)

```ts
export interface ValuationProvider {
  key: string;                                  // 'rentcast'
  supports: (subtype: string) => boolean;       // rentcast: real_estate only
  estimate(ref: string): Promise<{ value: number; low: number | null; high: number | null }>;
}
```

`manual` is not a provider — it is the absence of one. `providers/index.ts` returns the
configured provider or `null`; every call site must handle `null`.

#### 9.3 Schema additions

On `accounts`:
- `valuationProvider TEXT NULL` — `'rentcast'` or null. Null means manual, which is the
  default for every account.
- `valuationRef TEXT NULL` — the provider's lookup key. For RentCast, the property address.

On `balance_snapshots`:
- `source` gains `'estimate'`.
- `valueLow REAL NULL`, `valueHigh REAL NULL` — the AVM bounds.

**An AVM is a range, not a number.** Storing only the midpoint and rendering it beside a
typed figure would present a model output as a measurement. The register shows the point
value with the range on hover, and estimate-sourced rows are visually distinguishable from
manual ones.

#### 9.4 Behaviour rules

These are the correctness rules, and each gets a test:

1. **A manual entry always wins for the same `asOf`.** An estimate never overwrites a
   number the user typed. The upsert on `(accountId, asOf)` checks the existing row's
   `source` and refuses to replace `'manual'` with `'estimate'`.
2. **A failed fetch does not refresh anything.** If the provider errors, no row is written
   and the account **stays in the stale list**. A silent failure that leaves a stale value
   looking current is the worst outcome available here.
3. **At most one estimate per property per day**, enforced by the `(accountId, asOf)`
   uniqueness plus a guard before the call — free tiers are small and this must not burn
   through them.
4. **Opt-in per account.** Setting a key enables nothing on its own; each property must
   have `valuationProvider` and `valuationRef` set on its row.
5. **No background cron.** This deployment scales to zero, so fetches are triggered by an
   explicit "Refresh estimate" button on the row, plus an optional auto-refresh when the
   net worth page loads and that property is overdue. Both go through the same rate guard.

#### 9.5 Configuration

`RENTCAST_API_KEY` in `.env.local`, following the Plaid pattern — absent means the
provider is unavailable and the UI never offers it. Documented in `.env.example` and the
README configuration table as optional.

#### 9.6 Privacy consequence — must not be glossed

The README currently promises: *"All data stays on your own machine — nothing is sent to a
third party except the transaction text you ask Claude to classify and (optionally)
Plaid."* Phase 3 sends a **home address** to RentCast, which is a more identifying
disclosure than a transaction descriptor.

That sentence must be updated in the same PR that ships the provider, and the in-app
opt-in must state plainly what leaves the machine and where it goes. Shipping the feature
while the README still claims otherwise is not acceptable.

## Testing

TDD throughout — failing test first. Unit tests in `app/src/lib/netWorth/__tests__/`
using `makeTmpDb()`, driving real code paths rather than mocks:

- `netWorthSide` — every branch, and specifically that a Plaid credit card
  (`accountClass: 'spending'`, `type: 'credit'`) lands on the liability side.
- `valuationAt` — carry-forward across a gap; `null` before the first snapshot; the
  `investment_snapshots` fallback for investment accounts.
- `netWorthAt` — sign math; a never-valued account is excluded **and** reported in
  `missing`, not summed as zero.
- `netWorthSeries` — a period grid spanning a month with no new snapshot holds flat.
- `staleAccounts` — boundary at exactly the interval; `NULL` interval never goes stale.
- Snapshot upsert — two writes on the same `asOf` correct rather than duplicate.
- Catalog integrity — every entry's `accountClass`/`subtype` pair creates a valid account,
  every `securedByGroup` names a group that actually exists on the asset side, and every
  `key` is unique. A table-driven test over the whole array, so a typo in a new entry
  fails loudly rather than shipping a broken picker.
- `DELETE` is refused with 409 once any snapshot exists.
- **Close preserves history** — a car closed in June still contributes to March in
  `netWorthSeries`, but not to today's `netWorthAt`. This is the test that protects the
  trend chart from the sold-car regression, and it is the most important one here.
- Phase 2: `sync` writes a balance row per non-suppressed account, uses `Math.abs`, and
  writes **no row** when both `current` and `available` are null.
- Phase 3, against a stubbed provider (never the live API): an estimate does **not**
  overwrite a same-day manual row; a provider throw writes nothing and leaves the account
  in the stale list; the once-per-day guard blocks a second call; `providers/index.ts`
  returns `null` with no key configured and every call site tolerates it.

Playwright: one E2E covering the register inline edit — type a value, see the hero and the
chart update.

## Out of scope (YAGNI)

- **Vehicle** auto-valuation. VinAudit's $100/mo base fee is disproportionate for ~8 calls
  a year, and no self-serve alternative without a monthly floor was found. Cars keep the
  annual manual nudge. Revisit if that changes.
- Zillow specifically, by any route — the public API is retired and the wrapper services
  scrape against its terms.
- Automatic vehicle depreciation curves. Explicitly rejected during design — the app does
  not invent numbers.
- Net worth goals, projections, or forecasting.
- Multi-currency.
- Cost basis or capital-gains treatment for real estate.
- Deferred-tax modeling on pre-tax retirement balances. They are counted at full value and
  the catalog hint says so.
- Present-value estimation for pensions. Only a plan-reported lump sum is accepted.
- A user-editable catalog. It is code, and "Add custom item" covers the gaps.
- Reclassifying Plaid credit cards to `accountClass: 'liability'`. `netWorthSide` exists
  precisely so this is unnecessary.

## Risks / notes

- **Migration.** `accountClass` gains a value and `accounts` gains two columns. Both are
  additive with defaults; no existing row changes meaning. Run `npm run db:generate`, then
  hand-check the emitted SQL — `schema.ts:20` documents that the accounts unique index is
  already hand-edited and drizzle-kit cannot express it, so a regenerated migration must
  not clobber it.
- **Double-counting the IUL.** It is already an `insurance`-purpose investment account
  and is already summed by `householdValueAt`. Setup must attach to that row. A test
  should assert the IUL is counted exactly once.
- **Two valuation tables.** The accepted cost of this approach. `valuationAt` is the
  single place that knows about the union; nothing else may read either table directly for
  net worth purposes.
- **Snapshot the DB before migrating.** `snapshotDb('pre-networth')` per the data-safety
  rules in `app/CLAUDE.md`.
- **Phase 3 changes the app's privacy claim.** See §9.6 — the README sentence and the
  in-app opt-in copy ship in the same PR as the provider, or not at all.
- **Free-tier exhaustion.** RentCast allows 50 requests/month. The once-per-day-per-property
  guard keeps realistic usage near 4 calls/year, but the guard is the only thing standing
  between a refresh loop and a burned quota, so it is tested rather than assumed.
