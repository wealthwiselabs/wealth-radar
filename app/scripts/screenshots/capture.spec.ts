import { test, expect, type Page } from '@playwright/test';

/**
 * Writes the README screenshots. Driven by playwright.screenshots.config.ts
 * (viewport, scale factor, and the demo-data server live there); run it with
 * `npm run screenshots`, never `npm run e2e`.
 *
 * Only the two images the app's palette can invalidate are captured here:
 *
 *   home.png          charts across the whole dashboard
 *   transactions.png  category bars + the colored swatches on table rows
 *
 * accounts.png and login.png are deliberately absent. Neither page renders a
 * category color, so a theme change cannot make them stale, and regenerating
 * them would only churn the diff. That is also why scripts/seed-demo.ts pins
 * the account names and per-account counts: accounts.png is a fixed point the
 * demo data has to keep matching.
 */

const OUT = 'docs/screenshots';

/** Wait for the page to stop moving, then strip dev-only chrome. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  // Chart animations are disabled app-wide, but the canvases still need a
  // frame to paint once their data lands.
  await page.waitForTimeout(1200);
  // The Next dev-tools badge floats over the bottom-left of every page. The
  // previous screenshots caught it; a README should not advertise it.
  await page.addStyleTag({
    content: 'nextjs-portal,[data-nextjs-toast]{display:none!important}',
  });
}

test('capture home and transactions', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#transactions-table');
  await settle(page);

  // Guard against the most expensive failure mode: shooting an empty app and
  // committing screenshots that show a product with no data in it.
  await expect(page.getByText('191 transactions')).toBeVisible();

  await page.screenshot({ path: `${OUT}/home.png` });

  // Scroll so the category chart and the first table rows share the frame.
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h3')].find(
      (h) => h.textContent?.trim() === 'Spending by Category',
    );
    if (!heading?.parentElement) throw new Error('Could not find the Spending by Category card');
    const top = heading.parentElement.getBoundingClientRect().top + window.scrollY;
    // Offset tuned so the previous card's lower edge peeks in at the top and
    // two transaction rows clear the bottom, matching the original framing.
    window.scrollTo(0, top - 118);
  });
  await page.waitForTimeout(600);

  await page.screenshot({ path: `${OUT}/transactions.png` });
});
