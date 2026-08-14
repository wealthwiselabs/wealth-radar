// Shared-credential gate for a self-hosted instance. Kept dependency-free and
// Edge-runtime-safe (Web Crypto only, no Node builtins) so it can run inside
// Next.js middleware as well as in API route handlers.
//
// Config (all via env):
//   AUTH_PASSWORD  required to ENABLE the gate. Absent → gate is off (local dev
//                  and PDF-only open-source use stay frictionless).
//   AUTH_USERNAME  optional. If unset, the gate is password-only.
//   AUTH_SECRET    optional signing key for the session cookie. Falls back to
//                  AUTH_PASSWORD, so only one secret is strictly required.

export const SESSION_COOKIE = 'wwt_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function isAuthEnabled(): boolean {
  return !!process.env.AUTH_PASSWORD;
}

export type GateDecision = 'open' | 'blocked' | 'enforce';

/**
 * How the middleware should treat a request:
 * - `enforce`  a password is configured → require a valid session.
 * - `open`     no gate: either explicitly disabled, or local dev (so PDF-only
 *              and open-source local use aren't forced behind a login).
 * - `blocked`  production with NO password configured → fail closed and refuse
 *              to serve, rather than silently exposing data. Setting
 *              AUTH_PASSWORD (or AUTH_DISABLED=true to intentionally run open)
 *              clears it.
 */
export function gateDecision(
  env: { AUTH_PASSWORD?: string; AUTH_DISABLED?: string; NODE_ENV?: string } = process.env,
): GateDecision {
  if (env.AUTH_DISABLED === 'true') return 'open';
  if (env.AUTH_PASSWORD) return 'enforce';
  return env.NODE_ENV === 'production' ? 'blocked' : 'open';
}

function signingSecret(): string {
  return process.env.AUTH_SECRET || process.env.AUTH_PASSWORD || '';
}

/** Length-checked, branch-constant comparison. Avoids leaking match position. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacHex(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return toHex(sig);
}

/**
 * A session token is `<expEpochSeconds>.<hmac(exp)>`. Stateless: verification
 * only needs the signing secret, so there's nothing to store server-side.
 */
export async function createSessionToken(
  nowSeconds: number,
  secret = signingSecret(),
): Promise<string> {
  const payload = String(nowSeconds + SESSION_TTL_SECONDS);
  return `${payload}.${await hmacHex(payload, secret)}`;
}

export async function verifySessionToken(
  token: string,
  nowSeconds: number,
  secret = signingSecret(),
): Promise<boolean> {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacHex(payload, secret);
  if (!constantTimeEqual(sig, expected)) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > nowSeconds;
}

/**
 * True only if the supplied credentials match the configured ones. Password is
 * required; username is checked only when AUTH_USERNAME is set. Both halves are
 * always evaluated so a wrong username and a wrong password cost the same.
 */
export async function checkCredentials(username: string, password: string): Promise<boolean> {
  const expectedUser = process.env.AUTH_USERNAME ?? '';
  const expectedPass = process.env.AUTH_PASSWORD ?? '';
  if (!expectedPass) return false;
  const passOk = constantTimeEqual(password, expectedPass);
  const userOk = expectedUser === '' ? true : constantTimeEqual(username, expectedUser);
  return passOk && userOk;
}

/** Cookie attributes for the signed session. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}
