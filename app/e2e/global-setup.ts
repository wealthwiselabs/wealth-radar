import fs from 'fs';
import path from 'path';
import { createSessionToken, SESSION_COOKIE } from '../src/lib/auth';

// The e2e suite runs against a real production build (`next build` + `next
// start`; see playwright.config.ts). Unlike `next dev`, a production server's
// auth middleware fail-closes with a 503 when AUTH_PASSWORD is unset — which
// also deadlocks Playwright's webServer readiness check. So the e2e server sets
// AUTH_PASSWORD, and this global setup mints a matching signed session cookie
// and writes it as Playwright storageState, so every test (page navigations and
// the `request` fixture alike) starts already authenticated. No per-test login
// round-trip, and no dependence on `next dev`'s open gate.

// Single source of truth, imported by playwright.config.ts for webServer.env so
// the cookie is signed with the exact secret the server verifies against.
export const E2E_AUTH_PASSWORD = 'e2e-test-password';

// Kept out of data/ for the same reason as the e2e DB: it can never be confused
// with anything real. Gitignored (e2e/.auth/), regenerated on every run.
export const STORAGE_STATE = path.join(process.cwd(), 'e2e/.auth/state.json');

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // mirror auth.ts's token TTL

export default async function globalSetup(): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  // Sign with AUTH_PASSWORD explicitly: signingSecret() is AUTH_SECRET ||
  // AUTH_PASSWORD, and the server sets only AUTH_PASSWORD. This process may not
  // have it in env, so pass it directly rather than relying on process.env.
  const token = await createSessionToken(nowSeconds, E2E_AUTH_PASSWORD);

  // secure:false so the browser sends it over http://localhost — the login
  // route's secure:true only governs its own Set-Cookie; the middleware only
  // verifies the token's HMAC signature, never the cookie's attributes.
  const state = {
    cookies: [
      {
        name: SESSION_COOKIE,
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
        expires: nowSeconds + SESSION_TTL_SECONDS,
      },
    ],
    origins: [],
  };

  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  fs.writeFileSync(STORAGE_STATE, JSON.stringify(state));
}
