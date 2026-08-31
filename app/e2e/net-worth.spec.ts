import { test, expect, type Locator } from '@playwright/test';

// Ruling R10 moved ALL interaction coverage here: the repo has no jsdom and no
// testing-library, so the register's unit tests render statically and cannot
// click or type. These three flows are therefore the ONLY automated proof
// that typing a value + Enter, adding an item from the catalog, and entering
// a liability actually work.
//
// The e2e database (data/e2e/e2e.db) persists across specs — and across
// separate runs of this file — so account names must stay unique forever, not
// just within one run. A per-run timestamp gives every item a name no earlier
// or later run could ever collide with (the `accounts` table has a real
// unique index on (owner, institution, name, mask), and manual net-worth
// items all share owner='' and institution='Manual').
const RUN = Date.now();

/** formatCurrency (chartConfig.ts) renders "$1,150,000" — no cents, no sign. */
function parseTotal(text: string | null): number {
  const digits = (text ?? '').replace(/[^0-9]/g, '');
  return digits === '' ? 0 : parseInt(digits, 10);
}

async function totalOf(locator: Locator): Promise<number> {
  return parseTotal(await locator.textContent());
}

test('adding an item from the catalog and typing a new value into its row updates the assets total', async ({ page }) => {
  const name = `E2E NW Primary ${RUN}`;
  await page.goto('/net-worth');

  const assetsTotal = page.getByTestId('assets-total');
  await expect(assetsTotal).toBeVisible();
  const before = await totalOf(assetsTotal);

  // Add from the catalog picker.
  await page.getByRole('button', { name: /add item/i }).first().click();
  await page.getByLabel('Search items').fill('primary');
  // exact: true — Playwright's default name match is substring-based, and a
  // leftover row from an earlier run of this same spec (the e2e db persists
  // across runs) renders a "Remove E2E NW Primary <ts>" button whose
  // accessible name could otherwise be swept up by a loose match.
  await page.getByRole('button', { name: 'Primary residence', exact: true }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Current value').fill('415000');
  await page.getByRole('button', { name: 'Save' }).click();

  // The page refetches after the mutation — poll rather than assert once.
  await expect.poll(() => totalOf(assetsTotal)).toBe(before + 415000);

  // Now the core interaction: type a new value into the row and press Enter.
  const input = page.getByLabel(`Value for ${name}`);
  await expect(input).toBeVisible();
  await input.fill('430000');
  await input.press('Enter');

  await expect.poll(() => totalOf(assetsTotal)).toBe(before + 430000);
});

test('a liability entered as a positive amount increases the liabilities total', async ({ page }) => {
  const name = `E2E NW Mortgage ${RUN}`;
  await page.goto('/net-worth');

  const liabilitiesTotal = page.getByTestId('liabilities-total');
  await expect(liabilitiesTotal).toBeVisible();
  const before = await totalOf(liabilitiesTotal);

  await page.getByRole('button', { name: /add item/i }).last().click();
  await page.getByLabel('Search items').fill('mortgage');
  // exact: true — see the comment on the "Primary residence" pick above: a
  // leftover "Remove E2E NW Mortgage <ts>" button from an earlier run would
  // otherwise also match this substring search, making the click ambiguous.
  await page.getByRole('button', { name: 'Mortgage', exact: true }).click();
  await page.getByLabel('Name').fill(name);
  // Entered as what you owe — a positive magnitude. The sign that flips this
  // into a subtraction from net worth is derived server-side, never typed.
  await page.getByLabel('Current value').fill('620000');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect.poll(() => totalOf(liabilitiesTotal)).toBe(before + 620000);
});

test('an item saved with no value is named in the exclusion banner, never counted as zero', async ({ page }) => {
  const name = `E2E NW Second Car ${RUN}`;
  await page.goto('/net-worth');

  const assetsTotal = page.getByTestId('assets-total');
  await expect(assetsTotal).toBeVisible();
  const before = await totalOf(assetsTotal);

  await page.getByRole('button', { name: /add item/i }).first().click();
  await page.getByLabel('Search items').fill('car');
  // exact: true — same reasoning: a leftover "Remove E2E NW Second Car <ts>"
  // button from an earlier run would otherwise match this substring search.
  await page.getByRole('button', { name: 'Car', exact: true }).click();
  await page.getByLabel('Name').fill(name);
  // Deliberately leave "Current value" blank.
  await expect(page.getByText(/won't count toward your net worth until you value it/i)).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();

  const banner = page.getByText(/haven't valued yet/i);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(name);

  // Never absorbed as a zero: the total is unchanged, not reduced or padded.
  await expect.poll(() => totalOf(assetsTotal)).toBe(before);
});
