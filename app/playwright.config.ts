import { defineConfig } from '@playwright/test';

// Port 3100, not 3000: a real `next dev` (the developer's own session) is
// often already running on 3000 against the live data/app.db. If this config
// reused that server (reuseExistingServer: true + the same port), the tests
// below would run against real user data instead of the e2e.db copy — the
// exact mistake this suite exists to prevent. A dedicated port forces
// Playwright to always boot its own server with DATABASE_URL pointed at the
// copy, never silently attach to someone else's.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3100' },
  webServer: {
    command: 'npx next dev -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      // Run against a copy, in its own directory (not data/, where the real
      // app.db lives) so exportRules()'s preferences.json mirror — which is
      // derived from the resolved db file's own directory, not DATABASE_URL
      // identity — physically cannot land next to the real one. See the
      // comment on exportRules() in src/lib/storage.ts.
      DATABASE_URL: 'file:./data/e2e/e2e.db',
      // CRITICAL — do not remove: Next dev servers started from the same
      // directory share the .next/ build directory by default. The
      // developer's own `next dev` (port 3000, against the real data/app.db)
      // runs from this same directory, so without this override, this
      // e2e run would rewrite and prune .next/ out from under their live
      // server — that has already happened once: it deleted
      // .next/static/chunks/app/accounts/page.js mid-session and produced a
      // Runtime ChunkLoadError on the Accounts page, requiring the developer
      // to stop their server, `rm -rf .next`, and restart. Giving the e2e
      // server its own dist dir (see next.config.ts's NEXT_DIST_DIR read)
      // makes that impossible. Do NOT "simplify" this away — a future
      // reader who removes it will silently reintroduce that incident.
      NEXT_DIST_DIR: '.next-e2e',
      // Force suggestPattern()'s deterministic heuristic fallback instead of
      // a real Anthropic API call — .env.local has a real key, and an actual
      // network round-trip (or a hang, in a sandboxed/offline test run) made
      // the rule-preview dialog's pattern field flaky to assert on.
      ANTHROPIC_API_KEY: '',
      CLAUDE_API_KEY: '',
    },
  },
});
