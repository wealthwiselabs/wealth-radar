# Wealthwise

> Locally-hosted Next.js app. Import bank statement PDFs and/or sync accounts via Plaid;
> Claude classifies each transaction into a category/subcategory. All data stays on disk.

`AGENTS.md` is a symlink to this file — edit this one.

## Quick Reference

```bash
npm run dev          # Next dev server, http://localhost:3000
npm run build        # Production build
npm test             # vitest (unit)
npm run e2e          # Playwright
npm run db:generate  # drizzle-kit generate (after schema.ts changes)
npm run db:migrate   # apply migrations
npx tsc --noEmit     # typecheck
```

**Stop dev server:** `lsof -ti:3000 | xargs kill -9`

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind 4 · SQLite (`better-sqlite3`) +
Drizzle ORM · Plaid (`plaid`, `react-plaid-link`) · `pdfjs-dist` for client-side PDF text
extraction · `@anthropic-ai/sdk` for classification · Chart.js · vitest + Playwright.

## Structure

```
app/
├── src/app/          # routes, components, hooks, api/
│   └── api/          # classify, transactions, accounts, rules, coverage, plaid/*
├── src/lib/          # domain logic (see Invariants) + plaid/
├── src/db/           # drizzle schema, client, migrations
├── src/test/         # makeTmpDb helper
└── data/             # LIVE DATA — app.db, preferences.json, taxonomy.json, snapshots/
```

## Data safety — read before touching `data/`

- **`data/app.db` is the live store.** `data/transactions.csv` is a stale legacy export
  (superseded by the DB); do not treat it as the source of truth.
- Dev servers, tests, and scripts can silently write the real DB. Tests must use
  `makeTmpDb()` from `@/test/tmpDb` — never the production file.
- **Snapshot before any mutation.** `snapshotDb(label)` in `src/lib/backup.ts` writes to
  `data/snapshots/`; `syncAllItems` already takes a `pre-sync` snapshot. Ad hoc:
  `sqlite3 data/app.db ".backup 'data/snapshots/pre-<label>-<ts>.db'"`.
- Read-only inspection: `sqlite3 "file:data/app.db?mode=ro" "..."`.

## Invariants

**Account identity.** A Plaid account's identity is its `plaidAccountId`, never
(institution, name). The PDF/manual path instead matches the canonical
(institution, name) key and then disambiguates by `mask` — two people can hold the same
product at the same bank, so the mask *is* the identity. When no mask is supplied and
several candidates share the product, `resolveOrCreateAccount` throws rather than guess.

**Masks.** `maskFromSourceFile` only recognizes Chase's `-statements-<mask>-` filename
pattern. Other institutions fall back to `verifyMaskInText`, which requires exactly one
cue-verified account number on the page and rejects otherwise. Renaming a statement to
embed `-statements-1234-` forces deterministic routing.

**Owner** (`Alex` / `Sam`) comes only from the Plaid item — it is a property of
which login was connected. The PDF path never sets it, so a PDF that fails to match an
existing account creates an account with an empty owner.

**`superseded_by` is a reversible soft-delete.** It is honored by `aggregates`,
`readTransactions`, the accounts API, `ruleBackfill`, `accountMerge`, and ingest's
fingerprint dedupe — but *not* by ingest's `externalId` check (deliberately).

**Dedupe has two passes** (`deduplicateTransactions`):
1. exact `(accountId, fingerprint)` → hard delete;
2. cross-source near-duplicates → supersede.

Pass 2 exists because the same charge arrives from both feeds with different text —
Plaid returns a cleaned merchant name (`AWS`, `Venmo`) where the statement carries the raw
descriptor (`Amazon web services aws.amazon.co WA`). It matches on account + exact amount +
date within `CROSS_SOURCE_DATE_WINDOW_DAYS`, pairing greedily by closest date so N repeats
collapse N-to-N. **The Plaid row is always the one hidden**, because the statement
descriptor is more informative and because hiding the PDF row would let a re-import create
a fresh duplicate (fingerprint dedupe skips superseded rows; the `externalId` check does not).

**Aggregates** are derived. After changing transaction rows, call
`recomputeMonthlyAggregates(accountId, month)` for every affected pair, or totals drift
from the rows.

## Plaid

`syncAllItems` uses `transactions/sync` with a stored per-item cursor, so it only ever
returns changes *after* that cursor. Plaid's history floor is roughly 90 days before the
item was linked — **older history can only come from statement PDFs**, and no cursor reset
will recover it. Access tokens are AES-256-GCM encrypted (`lib/crypto.ts`,
`APP_ENCRYPTION_KEY`). A single failing item is isolated by `finishError` and never aborts
the loop over the rest.

## Testing

TDD: write the failing test, watch it fail, then implement. Unit tests live in
`src/lib/__tests__/`; use `makeTmpDb()` and drive real code paths (e.g.
`ingestClassifiedBatch`) rather than mocks.

## AI classification

`src/lib/classify.ts` uses `claude-sonnet-4-6`. The key comes from the UI (Settings →
`x-anthropic-api-key` header, stored in `localStorage`) or `ANTHROPIC_API_KEY` in
`.env.local`; the UI key wins when both are set.

## Environment

`.env.local` (see `.env.example`): `ANTHROPIC_API_KEY`, `DATABASE_URL`
(default `file:./data/app.db`), and for Plaid `PLAID_CLIENT_ID`, `PLAID_ENV`,
`PLAID_SECRET_<ENV>`, `APP_ENCRYPTION_KEY`. Absent Plaid config → the app is PDF-only.

## Running locally to test the assistant

No secrets or `.env.local` are needed to try the chat assistant — the Anthropic key is
entered in the UI, and the dev auth gate is off when `AUTH_PASSWORD` is unset.

1. `cd app && npm run db:migrate` — one-time. Creates `data/app.db` (gitignored) with all
   tables, including the assistant's `agent_conversations`, `agent_messages`, and
   `agent_memory`.
2. `cd app && npm run dev` → http://localhost:3000.
3. Open **Settings** (top-right) and paste your Anthropic API key. Optionally set the
   provider/model there too; it defaults to `claude-sonnet-5`. The key is stored in this
   browser's localStorage and sent per-request as the `x-agent-api-key` header.
4. Click the assistant launcher (bottom-right) and ask a question. PDF attach and
   classification use the same key.
5. Optional — to also exercise Plaid sync / bank import beyond PDFs, create your own local
   `app/.env.local` from `app/.env.example` (see Environment below). **Never commit it.**
6. Stop the server: `lsof -ti:3000 | xargs kill -9`.

## Git

Remote is GitHub (`wealthwiselabs/wealth-radar`). Commit only when asked.
