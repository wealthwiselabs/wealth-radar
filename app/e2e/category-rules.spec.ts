import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getDb, schema } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';

const E2E_DIR = path.join(process.cwd(), 'data/e2e');
const E2E_DB = path.join(E2E_DIR, 'e2e.db');

// A merchant token no real transaction will ever contain, so this suite's
// fixture data can never collide with (or be confused for) live data.
const MERCHANT = 'E2E Bookshop';
const DATE = '2025-06-15';
const MONTH = '2025-06';

const ACCOUNT_ID = 'e2e-account';

// Distinct disposable pattern for the "migrated rule" fixture used by the
// rules-screen and re-apply tests, replacing the "aplpay" pattern that used
// to come along for free with a copy of the real database.
const WIDGETPAY_PATTERN = 'e2e widgetpay';
const WIDGETPAY_RULE_ID = 'e2e-rule-widgetpay';
// One transaction per category so matches span exactly 6 distinct categories
// — one more than the app's MANY_CATEGORIES(5) threshold — so Enable still
// requires the in-page confirmation the re-apply test exercises.
const WIDGETPAY_CATEGORIES: Array<{ categoryId: string; subcategoryId: string }> = [
  { categoryId: 'housing', subcategoryId: 'rent' },
  { categoryId: 'utilities', subcategoryId: 'electric' },
  { categoryId: 'food', subcategoryId: 'grocery' },
  { categoryId: 'transportation', subcategoryId: 'fuel' },
  { categoryId: 'healthcare', subcategoryId: 'doctor' },
  { categoryId: 'shopping', subcategoryId: 'clothing' },
];

// This suite used to copy the real data/app.db and assert against whatever
// un-migrated "Kindle" rows happened to still be in it — which only held
// until the user actually applied that rule for real, at which point the
// test could never pass again (nothing left to correct). Instead, build a
// fully deterministic fixture: real schema (via the app's own migrations),
// synthetic data seeded directly through drizzle. No read of data/app.db at
// all, so this suite can never depend on (or be broken by) live data.
test.beforeAll(() => {
  fs.mkdirSync(E2E_DIR, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${E2E_DB}${suffix}`, { force: true });
  }

  // Point this process's db singleton at the isolated e2e file before
  // creating it. This only affects the Playwright test-runner process; the
  // `next dev` server under test reads the same path from its own
  // DATABASE_URL (set in playwright.config.ts's webServer.env).
  process.env.DATABASE_URL = `file:${path.relative(process.cwd(), E2E_DB)}`;
  runMigrations();

  const db = getDb();
  const now = new Date().toISOString();

  db.insert(schema.accounts).values({
    id: ACCOUNT_ID,
    name: 'E2E Checking',
    institution: 'E2E Bank',
    createdAt: now,
    modifiedAt: now,
  }).run();

  let n = 0;
  const tx = (opts: {
    id: string; description: string; categoryId: string; subcategoryId: string;
    categorySource: 'ai' | 'rule' | 'manual';
  }) => {
    n += 1;
    db.insert(schema.transactions).values({
      id: opts.id,
      accountId: ACCOUNT_ID,
      date: DATE,
      month: MONTH,
      description: opts.description,
      amount: -10 - n,
      categoryId: opts.categoryId,
      subcategoryId: opts.subcategoryId,
      categorySource: opts.categorySource,
      fingerprint: `e2e-fp-${opts.id}`,
      createdAt: now,
      modifiedAt: now,
    }).run();
  };

  // --- "correcting one row backfills the rest" fixture (17 matching rows) ---

  // The one row the test corrects by hand through the UI. Starts identical
  // to the "still wrong" rows below — its own description is what seeds the
  // rule's suggested pattern.
  tx({
    id: 'e2e-bk-target', description: `${MERCHANT}*T1`,
    categoryId: 'entertainment', subcategoryId: 'streaming', categorySource: 'ai',
  });
  // 11 more rows still miscategorized — these are what the rule backfills.
  for (let i = 1; i <= 11; i++) {
    tx({
      id: `e2e-bk-change-${i}`, description: `${MERCHANT}*C${i}`,
      categoryId: 'entertainment', subcategoryId: 'streaming', categorySource: 'ai',
    });
  }
  // 3 rows already in the target category — prove "already correct" counts
  // them without touching them again.
  for (let i = 1; i <= 3; i++) {
    tx({
      id: `e2e-bk-already-${i}`, description: `${MERCHANT}*A${i}`,
      categoryId: 'education', subcategoryId: 'books', categorySource: 'ai',
    });
  }
  // 2 rows a user has already hand-corrected (to a DIFFERENT category) —
  // prove a rule never overrides a manual categorization.
  for (let i = 1; i <= 2; i++) {
    tx({
      id: `e2e-bk-manual-${i}`, description: `${MERCHANT}*M${i}`,
      categoryId: 'entertainment', subcategoryId: 'streaming', categorySource: 'manual',
    });
  }

  // --- rows for the category/subcategory debounce tests below. Distinct,
  // never-elsewhere-matched descriptions so the rule preview's pattern match
  // can only ever hit the one row each test cares about. ---
  tx({
    id: 'e2e-debounce-two-step', description: 'E2E Debounce TwoStep',
    categoryId: 'shopping', subcategoryId: 'clothing', categorySource: 'ai',
  });
  tx({
    id: 'e2e-debounce-category-only', description: 'E2E Debounce CatOnly',
    categoryId: 'utilities', subcategoryId: 'electric', categorySource: 'ai',
  });

  // --- rows for the "adjust the target category inside the prompt" test.
  // Deliberately split across two categories so that re-pointing the dropdown
  // moves rows BETWEEN the already-correct and will-change buckets — the
  // counts alone then prove the preview refetched for the new target rather
  // than reusing the one fetched for the old one. ---
  tx({
    id: 'e2e-pick-target', description: 'E2E DropdownPick*T',
    categoryId: 'shopping', subcategoryId: 'clothing', categorySource: 'ai',
  });
  for (let i = 1; i <= 2; i++) {
    tx({
      id: `e2e-pick-change-${i}`, description: `E2E DropdownPick*C${i}`,
      categoryId: 'shopping', subcategoryId: 'clothing', categorySource: 'ai',
    });
  }
  tx({
    id: 'e2e-pick-housing', description: 'E2E DropdownPick*H',
    categoryId: 'housing', subcategoryId: 'rent', categorySource: 'ai',
  });

  // --- "migrated rule" fixture used by the rules-screen + re-apply tests ---

  for (const [i, cat] of WIDGETPAY_CATEGORIES.entries()) {
    tx({
      id: `e2e-wp-${i + 1}`, description: `E2E WidgetPay #${i + 1}`,
      categoryId: cat.categoryId, subcategoryId: cat.subcategoryId, categorySource: 'ai',
    });
  }
  db.insert(schema.categoryRules).values({
    id: WIDGETPAY_RULE_ID,
    pattern: WIDGETPAY_PATTERN,
    categoryId: 'other',
    subcategoryId: 'uncategorized',
    enabled: false,
    createdAt: now,
    updatedAt: now,
  }).run();

  // Padding so the 17-row bookshop fixture stays under the rule preview's
  // "matches more than 10% of your history" warning threshold (which a tiny
  // all-synthetic database would otherwise trip on its own, forcing an extra
  // "I've checked the pattern" confirmation this test isn't about). Dated
  // well before the real fixture rows so it never displaces them from the
  // table's default (newest-first) first page.
  const FILLER_DATE = '2020-01-01';
  const FILLER_MONTH = '2020-01';
  const filler = Array.from({ length: 400 }, (_, i) => ({
    id: `e2e-filler-${i}`,
    accountId: ACCOUNT_ID,
    date: FILLER_DATE,
    month: FILLER_MONTH,
    description: `E2E Filler #${i}`,
    amount: -1,
    categoryId: 'other',
    subcategoryId: 'uncategorized',
    categorySource: 'ai' as const,
    fingerprint: `e2e-fp-filler-${i}`,
    createdAt: now,
    modifiedAt: now,
  }));
  db.insert(schema.transactions).values(filler).run();
});

function bookshopCounts() {
  const db = new Database(E2E_DB, { readonly: true });
  const rows = db.prepare(
    `SELECT category_id AS c, subcategory_id AS s, category_source AS src, COUNT(*) AS n
     FROM transactions WHERE lower(description) LIKE '%e2e bookshop%'
     GROUP BY c, s, src`,
  ).all() as Array<{ c: string; s: string; src: string; n: number }>;
  db.close();
  return rows;
}

test('correcting one row backfills the rest, skips manual rows, and reports exact counts', async ({ page }) => {
  const before = bookshopCounts();
  const sum = (pred: (r: { c: string; s: string; src: string }) => boolean) =>
    before.filter(pred).reduce((acc, r) => acc + r.n, 0);
  // Sanity-check the fixture itself before relying on it.
  expect(sum((r) => r.c === 'entertainment' && r.src === 'ai')).toBe(12);
  expect(sum((r) => r.c === 'education' && r.s === 'books' && r.src === 'ai')).toBe(3);
  expect(sum((r) => r.c === 'entertainment' && r.src === 'manual')).toBe(2);

  await page.goto('/');
  // The table loads via a client-side fetch after mount, so the first row
  // isn't there yet at goto()-return. Wait for real data before querying it.
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  // A distinctive suffix (unlike the old "Kindle Svcs" fixture) means the
  // target row can be located directly, with no need to scan candidates.
  const row = page.locator('tr', { hasText: `${MERCHANT}*T1` });
  await expect(row).toBeVisible();
  await expect(row.getByRole('combobox').first()).toHaveValue('entertainment');

  // Recategorizing via the category <select> alone commits immediately and
  // lands on Education's FIRST subcategory (Tuition, per data/taxonomy.json)
  // — not Books — but does NOT open a rule-prompt dialog, since the user
  // hasn't chosen a subcategory yet. Wait for the row's subcategory <select>
  // to reflect Education's subcategories (i.e. the commit has landed) before
  // picking Books, which is what opens the dialog.
  await row.getByRole('combobox').first().selectOption({ label: 'Education' });
  await expect(row.getByRole('combobox').nth(1)).toHaveValue('tuition');

  await row.getByRole('combobox').nth(1).selectOption({ label: 'Books' });

  const dialog = page.getByRole('dialog', { name: /create a category rule/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Description contains')).toHaveValue(/e2e bookshop/i);

  // This hand-edit itself just landed as categorySource='manual' (the
  // /api/transactions PUT route marks any direct category edit manual), so
  // the preview counts it under "skipped", not "already correct" — that's
  // real behavior worth pinning down, not an artifact of the fixture design.
  // Exact numbers: 3 pre-seeded already-correct rows, 11 still-miscategorized
  // rows the rule will change, and 3 skipped (2 pre-seeded manual + this row).
  await expect(dialog.getByText('3 already Education > Books')).toBeVisible();
  await expect(dialog.getByText('11 will change')).toBeVisible();
  await expect(dialog.getByText('3 skipped — you set these by hand')).toBeVisible();

  await dialog.getByRole('button', { name: /apply to 11 and save rule/i }).click();
  await expect(dialog).toBeHidden();

  const after = bookshopCounts();
  const afterSum = (pred: (r: { c: string; s: string; src: string }) => boolean) =>
    after.filter(pred).reduce((acc, r) => acc + r.n, 0);

  // All non-manual entertainment rows moved; the 2 manual rows were skipped
  // and are still sitting there, proving the rule never touched them.
  expect(afterSum((r) => r.c === 'entertainment' && r.src === 'ai')).toBe(0);
  expect(afterSum((r) => r.c === 'entertainment' && r.src === 'manual')).toBe(2);
  // 3 originally-correct + 1 hand-corrected target + 11 rule-applied = 15.
  expect(afterSum((r) => r.c === 'education' && r.s === 'books')).toBe(15);
});

test('changing category then subcategory in quick succession opens exactly one prompt, for the final pair', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  const row = page.locator('tr', { hasText: 'E2E Debounce TwoStep' });
  await expect(row).toBeVisible();
  await expect(row.getByRole('combobox').first()).toHaveValue('shopping');

  // Step 1: category only. Commits immediately, landing on Education's FIRST
  // subcategory (Tuition) — a pairing the user never chose. No dialog should
  // appear before the follow-up subcategory change.
  await row.getByRole('combobox').first().selectOption({ label: 'Education' });
  await expect(row.getByRole('combobox').nth(1)).toHaveValue('tuition');

  const dialog = page.getByRole('dialog', { name: /create a category rule/i });
  await expect(dialog).toBeHidden();

  // Step 2: subcategory, right on the heels of step 1 — well inside the 2s
  // debounce window. This should replace the pending (Tuition) prompt rather
  // than queue a second one alongside it.
  await row.getByRole('combobox').nth(1).selectOption({ label: 'Books' });

  // The single prompt that eventually fires must describe the FINAL pair.
  // The target is now a pair of dropdowns rather than static text, so assert on
  // the selected values. (A "Tuition is absent" check no longer means anything
  // here — Tuition is legitimately present as one of Education's <option>s;
  // what matters is that it is not the one selected.)
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Category', { exact: true })).toHaveValue('education');
  await expect(dialog.getByLabel('Subcategory', { exact: true })).toHaveValue('books');

  // Close it, then wait past another debounce window to prove no second
  // (stale, Tuition-describing) prompt was queued behind this one.
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(2500);
  await expect(dialog).toBeHidden();
});

test('changing only the category still eventually opens the prompt, once the debounce elapses', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  const row = page.locator('tr', { hasText: 'E2E Debounce CatOnly' });
  await expect(row).toBeVisible();
  await expect(row.getByRole('combobox').first()).toHaveValue('utilities');

  const dialog = page.getByRole('dialog', { name: /create a category rule/i });

  // Entertainment's own first subcategory is Streaming (data/taxonomy.json),
  // so touching only the category dropdown here never requires a second
  // dropdown change to land on the "right" subcategory — exactly the gap
  // this change closes: previously no prompt was ever offered in this case.
  await row.getByRole('combobox').first().selectOption({ label: 'Entertainment' });
  await expect(row.getByRole('combobox').nth(1)).toHaveValue('streaming');

  // Immediately after the change, still within the debounce window.
  await expect(dialog).toBeHidden();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Category', { exact: true })).toHaveValue('entertainment');
  await expect(dialog.getByLabel('Subcategory', { exact: true })).toHaveValue('streaming');
});

test('the rule prompt lets the target category be adjusted, and re-previews for it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  // Open the prompt the usual way — by hand-correcting one row.
  const row = page.locator('tr', { hasText: 'E2E DropdownPick*T' });
  await expect(row).toBeVisible();
  await row.getByRole('combobox').first().selectOption({ label: 'Education' });
  await expect(row.getByRole('combobox').nth(1)).toHaveValue('tuition');
  await row.getByRole('combobox').nth(1).selectOption({ label: 'Books' });

  const dialog = page.getByRole('dialog', { name: /create a category rule/i });
  await expect(dialog).toBeVisible();

  // The target is now editable in place rather than fixed text.
  const category = dialog.getByLabel('Category', { exact: true });
  const subcategory = dialog.getByLabel('Subcategory', { exact: true });
  await expect(category).toHaveValue('education');
  await expect(subcategory).toHaveValue('books');

  // Seeded target: nothing is Education > Books yet; the 2 clothing rows and
  // the 1 housing row would all move; the just-corrected row is manual.
  await expect(dialog.getByText('0 already Education > Books')).toBeVisible();
  await expect(dialog.getByText('3 will change')).toBeVisible();

  // Re-point at Housing. The subcategory must follow to Housing's first
  // subcategory (Rent, per data/taxonomy.json) rather than keep a stale
  // Education subcategory.
  await category.selectOption({ label: 'Housing' });
  await expect(subcategory).toHaveValue('rent');

  // The counts must be recomputed for the NEW target: the housing row is now
  // already correct, leaving 2 to change.
  await expect(dialog.getByText('1 already Housing > Rent')).toBeVisible();
  await expect(dialog.getByText('2 will change')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /apply to 2 and save rule/i })).toBeEnabled();
});

test('the rules screen lists the migrated rules as disabled', async ({ page }) => {
  await page.goto('/rules');
  await expect(page.getByRole('heading', { name: /category rules/i })).toBeVisible();
  // Rules render as table rows (<tr>), not <li>s.
  const widgetpay = page.locator('tr', { hasText: WIDGETPAY_PATTERN });
  await expect(widgetpay).toBeVisible();
  await expect(widgetpay.getByRole('button', { name: 'Enable' })).toBeVisible();
  await expect(widgetpay).toContainText('categories');
});

// Playwright auto-dismisses native dialogs (window.confirm etc.) unless a
// page.on('dialog', ...) handler is registered — the same behavior real
// browsers fall into once a user has hit "prevent this page from creating
// additional dialogs" a few times, and exactly what an embedded/automated
// browser does outright. That's the bug: a delete driven by window.confirm
// silently no-ops here, the same as it did for the user. This test
// deliberately does NOT add a dialog handler — the fix must make Delete work
// via an in-page confirmation the browser cannot suppress, not by making the
// test cooperate with the native dialog.
test('deleting a rule removes it from the list without relying on a native dialog', async ({ page, request }) => {
  // A dedicated, disposable rule — created fresh through the real API, not
  // the shared WidgetPay fixture other tests in this file depend on — so
  // deleting it here can't starve the re-apply test below of the row it needs.
  const pattern = `e2e-delete-target-${Date.now()}`;
  const created = await request.post('/api/rules', {
    data: { pattern, categoryId: 'housing', subcategoryId: 'rent' },
  });
  expect(created.ok()).toBe(true);

  await page.goto('/rules');
  await expect(page.getByRole('heading', { name: /category rules/i })).toBeVisible();

  const target = page.locator('tr', { hasText: pattern });
  await expect(target).toBeVisible();

  await target.getByRole('button', { name: 'Delete' }).click();
  // In-page confirmation: the row itself should now offer Confirm/Cancel
  // rather than a native dialog appearing.
  await target.getByRole('button', { name: 'Confirm' }).click();

  await expect(page.locator('tr', { hasText: pattern })).toHaveCount(0);
});

test('re-applying a rule requires and honors the in-page confirmation', async ({ page }) => {
  await page.goto('/rules');
  await expect(page.getByRole('heading', { name: /category rules/i })).toBeVisible();

  // WidgetPay starts disabled (migrated rules are), and Re-apply is disabled
  // until a rule is enabled. Its matches span 6 distinct categories — more
  // than MANY_CATEGORIES (5) — so Enable itself also requires the in-page
  // confirmation here — the same mechanism Re-apply and Delete use.
  const widgetpay = page.locator('tr', { hasText: WIDGETPAY_PATTERN });
  await expect(widgetpay).toBeVisible();
  await widgetpay.getByRole('button', { name: 'Enable' }).click();
  await widgetpay.getByRole('button', { name: 'Confirm' }).click();
  await expect(widgetpay.getByRole('button', { name: 'Disable' })).toBeVisible();

  await widgetpay.getByRole('button', { name: 'Re-apply' }).click();
  // Confirming should be required: Cancel must leave the rule listed and
  // untouched (no native dialog involved either way).
  await expect(widgetpay.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await widgetpay.getByRole('button', { name: 'Cancel' }).click();
  await expect(widgetpay.getByRole('button', { name: 'Re-apply' })).toBeVisible();

  await widgetpay.getByRole('button', { name: 'Re-apply' }).click();
  await widgetpay.getByRole('button', { name: 'Confirm' }).click();
  // All 6 fixture rows are categorySource='ai' and none already 'other >
  // uncategorized', so the exact result is deterministic.
  await expect(page.getByText('6 transactions updated, 0 skipped as manual.')).toBeVisible();
});
