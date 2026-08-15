import { defineConfig } from '@playwright/test';

/**
 * Captures the README screenshots. Run via `npm run screenshots`, which seeds
 * the demo database first — this config does not seed, it only shoots.
 *
 * Separate from playwright.config.ts because this is not a test suite: it
 * writes image files and asserts almost nothing. Keeping it out of `testDir:
 * './e2e'` means `npm run e2e` never rewrites docs/screenshots as a side
 * effect of running the tests.
 *
 * The port / DATABASE_URL / NEXT_DIST_DIR trio below is the same defensive
 * arrangement the e2e config uses, and for the same reasons — see the long
 * comment there. In short: a third port so this never attaches to a developer's
 * own server on 3000 (or the e2e server on 3100) and shoots real financial data
 * into a public README; a demo database in its own directory so neither the
 * live app.db nor the real preferences.json is reachable; and a private dist
 * directory so booting this server cannot prune .next/ out from under a running
 * dev session.
 */
export default defineConfig({
  testDir: './scripts/screenshots',
  timeout: 120_000,
  // One worker: both shots drive the same page and write fixed filenames.
  workers: 1,
  // A failed capture should be fixed, not silently retried into a stale image.
  retries: 0,
  use: {
    baseURL: 'http://localhost:3200',
    // 1280x900 at DPR 2 produces the 2560x1800 the committed files already
    // use, so refreshed images drop in at the same size and crop.
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    // Pin the palette: the app defaults to following the OS, and screenshots
    // must not change depending on whose machine ran them.
    colorScheme: 'light',
  },
  webServer: {
    command: 'npx next dev -p 3200',
    url: 'http://localhost:3200',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: 'file:./data/demo/demo.db',
      NEXT_DIST_DIR: '.next-demo',
      // The demo data is owned by Alex / Sam / Joint; without this the account
      // rows would render the "Person 1, Person 2" default and stop matching
      // docs/screenshots/accounts.png.
      NEXT_PUBLIC_ACCOUNT_OWNERS: 'Alex,Sam',
      // Generating documentation must never be able to spend money on the
      // Anthropic API, whatever .env.local happens to hold.
      ANTHROPIC_API_KEY: '',
      CLAUDE_API_KEY: '',
    },
  },
});
