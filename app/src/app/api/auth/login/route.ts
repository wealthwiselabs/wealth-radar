import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  checkCredentials,
  createSessionToken,
  isAuthEnabled,
  sessionCookieOptions,
} from '@/lib/auth';

/** Only allow same-origin absolute paths as the post-login destination. */
function safeFrom(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/login')) {
    return '/';
  }
  return raw;
}

/**
 * Redirect with a RELATIVE Location. Behind Fly's proxy, `req.url` is the
 * internal bind address (http://0.0.0.0:3000), so building an absolute URL from
 * it sends the browser to 0.0.0.0. A relative Location is resolved by the
 * browser against the real address-bar origin instead.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const username = String(form.get('username') ?? '');
  const password = String(form.get('password') ?? '');
  const from = safeFrom(String(form.get('from') ?? ''));

  // If the gate is disabled, there's nothing to log into.
  if (!isAuthEnabled()) return redirectTo('/');

  if (!(await checkCredentials(username, password))) {
    const dest =
      from === '/' ? '/login?error=1' : `/login?error=1&from=${encodeURIComponent(from)}`;
    return redirectTo(dest);
  }

  const token = await createSessionToken(Math.floor(Date.now() / 1000));
  const res = redirectTo(from);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
}
