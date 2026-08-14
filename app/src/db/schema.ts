import { sqliteTable, text, real, integer, index, unique } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),                 // "Credit Card", "Chase Sapphire Preferred"
  institution: text('institution').notNull(),   // "Chase"
  mask: text('mask'),                            // last 4, nullable
  owner: text('owner').notNull().default(''),    // free text; '' = unassigned. Selectable values come from src/lib/owners.ts
  nameSource: text('name_source').notNull().default('derived'), // derived | user
  accountClass: text('account_class').notNull().default('spending'), // spending | investment | liability
  purpose: text('purpose').notNull().default('portfolio'), // portfolio | reserve | insurance
  type: text('type').notNull().default('unknown'),
  subtype: text('subtype'),
  origin: text('origin').notNull().default('manual'), // plaid | manual
  plaidItemId: text('plaid_item_id'),            // FK added in Phase 2
  plaidAccountId: text('plaid_account_id'),
  closedAtMonth: text('closed_at_month'),
  status: text('status').notNull().default('active'), // active | closed
  createdAt: text('created_at').notNull(),
  modifiedAt: text('modified_at').notNull(),
}, (t) => ({
  // NOTE: the real index is on (owner, institution, name, coalesce(mask,'')) —
  // drizzle-kit cannot express an expression index, so the migration SQL is
  // hand-edited and this declaration is an approximation. Without the coalesce,
  // SQLite treats NULL masks as distinct and two mask-less rows for the same
  // (owner, institution, name) would be allowed.
  byOwnerInstitutionNameMask: unique('accounts_owner_institution_name_mask')
    .on(t.owner, t.institution, t.name, t.mask),
}));

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  date: text('date').notNull(),                  // YYYY-MM-DD
  month: text('month').notNull(),                // YYYY-MM
  description: text('description').notNull().default(''),
  amount: real('amount').notNull().default(0),
  categoryId: text('category_id').notNull().default(''),
  subcategoryId: text('subcategory_id').notNull().default(''),
  // How this row's category was set. 'manual' rows are never touched by a rule.
  categorySource: text('category_source').notNull().default('ai'), // ai | rule | manual
  note: text('note').notNull().default(''),
  source: text('source').notNull().default('pdf'), // plaid | pdf | manual
  externalId: text('external_id'),               // Plaid transaction_id (Phase 2)
  fingerprint: text('fingerprint').notNull(),
  plaidCategory: text('plaid_category'),
  pending: integer('pending', { mode: 'boolean' }).notNull().default(false),
  sourceFile: text('source_file'),
  supersededBy: text('superseded_by'),
  createdAt: text('created_at').notNull(),
  modifiedAt: text('modified_at').notNull(),
}, (t) => ({
  byAccountDate: index('tx_account_date').on(t.accountId, t.date),
  byMonth: index('tx_month').on(t.month),
  uniqExternal: unique('tx_account_external').on(t.accountId, t.externalId),
  byFingerprint: index('tx_fingerprint').on(t.fingerprint),
}));

export const monthlyAggregates = sqliteTable('monthly_aggregates', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  month: text('month').notNull(),                // YYYY-MM
  categoryId: text('category_id'),               // NULL = account-level summary row
  expenseTotal: real('expense_total').notNull().default(0),
  incomeTotal: real('income_total').notNull().default(0),
  net: real('net').notNull().default(0),
  txnCount: integer('txn_count').notNull().default(0),
  derivedFromTxns: integer('derived_from_txns', { mode: 'boolean' }).notNull().default(true),
  source: text('source').notNull().default('pdf'),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  uniq: unique('agg_account_month_cat').on(t.accountId, t.month, t.categoryId),
}));

export const statementImports = sqliteTable('statement_imports', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  month: text('month').notNull(),                // YYYY-MM
  sourceFile: text('source_file'),
  importedAt: text('imported_at').notNull(),
}, (t) => ({
  uniq: unique('stmt_account_month').on(t.accountId, t.month),
}));

export const categoryRules = sqliteTable('category_rules', {
  id: text('id').primaryKey(),
  // Always lowercased and trimmed — see normalizePattern in lib/categoryRules.ts.
  pattern: text('pattern').notNull(),
  categoryId: text('category_id').notNull(),
  subcategoryId: text('subcategory_id').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  // One rule per pattern; creating a rule for an existing pattern updates it.
  uniqPattern: unique('rules_pattern').on(t.pattern),
}));

// Declared now so accounts.plaidItemId has a home; unused until Phase 2.
export const plaidItems = sqliteTable('plaid_items', {
  id: text('id').primaryKey(),
  plaidItemId: text('plaid_item_id').notNull(),
  institutionId: text('institution_id'),
  institutionName: text('institution_name'),
  owner: text('owner').notNull().default(''),   // accounts from this Item inherit it
  accessToken: text('access_token').notNull(),
  cursor: text('cursor'),
  status: text('status').notNull().default('healthy'),
  error: text('error'),
  needsInvestmentsConsent: integer('needs_investments_consent', { mode: 'boolean' }).notNull().default(false),
  syncedThroughMonth: text('synced_through_month'),
  lastSyncedAt: text('last_synced_at'),
  createdAt: text('created_at').notNull(),
  modifiedAt: text('modified_at').notNull(),
});

// Plaid accounts the user has individually removed while keeping the parent Item
// connected. Without this, the next sync's account-provisioning step re-creates the
// row (its plaidAccountId lookup misses the deleted row) and the account reappears.
// Keyed by plaidAccountId — a Plaid account's stable identity — so the sync guard is
// a simple set membership check. Suppression only blocks automatic re-adds: a
// deliberate reconnect (exchange) lifts it. Removing the whole Item does NOT record
// here; those accounts are gone with the Item and cannot re-sync.
export const suppressedPlaidAccounts = sqliteTable('suppressed_plaid_accounts', {
  plaidAccountId: text('plaid_account_id').primaryKey(),
  plaidItemId: text('plaid_item_id'),           // the app-side plaidItems.id it belonged to (audit only)
  institution: text('institution').notNull().default(''),
  name: text('name').notNull().default(''),
  mask: text('mask'),
  createdAt: text('created_at').notNull(),
});

export const securities = sqliteTable('securities', {
  id: text('id').primaryKey(),
  // Nullable: 401k collective trusts, stable-value funds, and the RMB money
  // fund have no ticker at all. Uniqueness is enforced by a partial index in
  // the migration, since NULLs must stay distinct.
  ticker: text('ticker'),
  name: text('name').notNull(),
  // What wrapper is it: etf | mutual_fund | stock | collective_trust | insurance | other
  kind: text('kind').notNull().default('other'),
  // What asset class is it: equity | bond | money_market | cash | insurance | other
  assetType: text('asset_type').notNull().default('other'),
  // Reporting dimensions. Left NULL in Phase 1 except on backfill-seeded rows;
  // the tagging flow lands in Phase 3.
  region: text('region'),
  cap: text('cap'),
  style: text('style'),
  sector: text('sector'),
  tagSource: text('tag_source').notNull().default('seed'), // seed | ai-confirmed | user
  createdAt: text('created_at').notNull(),
  modifiedAt: text('modified_at').notNull(),
});

export const investmentSnapshots = sqliteTable('investment_snapshots', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  asOf: text('as_of').notNull(),                 // YYYY-MM-DD
  month: text('month').notNull(),                // YYYY-MM
  source: text('source').notNull().default('manual'), // plaid | paste | manual | legacy
  // Authoritative account total. Kept alongside holdings rather than summed
  // from them, because some accounts report a total with no holdings detail
  // and because a disagreement between the two should be visible, not absorbed.
  totalValue: real('total_value').notNull().default(0),
  holdingsComplete: integer('holdings_complete', { mode: 'boolean' }).notNull().default(false),
  note: text('note').notNull().default(''),
  createdAt: text('created_at').notNull(),
  modifiedAt: text('modified_at').notNull(),
}, (t) => ({
  uniq: unique('snap_account_asof').on(t.accountId, t.asOf),
  byMonth: index('snap_month').on(t.month),
}));

export const snapshotHoldings = sqliteTable('snapshot_holdings', {
  id: text('id').primaryKey(),
  snapshotId: text('snapshot_id').notNull().references(() => investmentSnapshots.id),
  securityId: text('security_id').notNull().references(() => securities.id),
  // Nullable: several 401k portals report value with no share count.
  quantity: real('quantity'),
  value: real('value').notNull().default(0),
}, (t) => ({
  uniq: unique('holding_snapshot_security').on(t.snapshotId, t.securityId),
}));

export const securityPurposes = sqliteTable('security_purposes', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  securityId: text('security_id').notNull().references(() => securities.id),
  purpose: text('purpose').notNull(),            // portfolio | reserve | insurance
  createdAt: text('created_at').notNull(),
  modifiedAt: text('modified_at').notNull(),
}, (t) => ({
  uniq: unique('secpurpose_account_security').on(t.accountId, t.securityId),
}));

export const cashFlows = sqliteTable('cash_flows', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  securityId: text('security_id').references(() => securities.id),  // attributes a contribution to a node; null = account-level
  date: text('date').notNull(),                  // YYYY-MM-DD — day weighting needs this
  amount: real('amount').notNull().default(0),   // + into the account, − out
  kind: text('kind').notNull().default('contribution'), // contribution | withdrawal | transfer_in | transfer_out
  source: text('source').notNull().default('manual'),   // manual | plaid | suggested
  // Suggested flows stay out of the return math until accepted.
  confirmed: integer('confirmed', { mode: 'boolean' }).notNull().default(true),
  note: text('note').notNull().default(''),
  // For a plaid-derived flow: the investment_transactions.id it came from.
  // Derivation inserts a flow only when no row already carries this ref, so
  // re-syncs never duplicate and never clobber a flow the user later edited.
  sourceRef: text('source_ref'),
  supersededBy: text('superseded_by'),  // set by a statement flow that overrides this one; excluded from ROI/allocation reads
  createdAt: text('created_at').notNull(),
  modifiedAt: text('modified_at').notNull(),
}, (t) => ({
  byAccountDate: index('flow_account_date').on(t.accountId, t.date),
}));

export const investmentTransactions = sqliteTable('investment_transactions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id),
  // Plaid's stable id for the transaction — the dedup key for idempotent re-sync.
  plaidInvestmentTxnId: text('plaid_investment_txn_id').notNull().unique(),
  securityId: text('security_id').references(() => securities.id), // null for cash transactions
  date: text('date').notNull(),                  // YYYY-MM-DD
  name: text('name').notNull().default(''),
  // Stored raw, in Plaid's sign convention (+ = cash debited/out). Normalized
  // only when deriving a cash_flow (our sign = −plaid).
  amount: real('amount').notNull().default(0),
  quantity: real('quantity'),
  price: real('price'),
  fees: real('fees'),
  type: text('type').notNull().default(''),      // buy | sell | cash | fee | transfer | cancel
  subtype: text('subtype'),                      // contribution | dividend | deposit | withdrawal | ...
  createdAt: text('created_at').notNull(),
  modifiedAt: text('modified_at').notNull(),
}, (t) => ({
  byAccountDate: index('invtxn_account_date').on(t.accountId, t.date),
}));
