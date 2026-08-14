import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, gateDecision, verifySessionToken } from '@/lib/auth';

// Paths reachable without a session — the login page and its endpoints.
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(req: NextRequest) {
  const decision = gateDecision();

  // Local dev / intentionally-disabled: serve openly.
  if (decision === 'open') return NextResponse.next();

  // Production with no password configured: fail closed rather than expose data.
  if (decision === 'blocked') {
    return new NextResponse(
      'Login is not configured for this deployment. Set the AUTH_PASSWORD secret to enable access.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  // decision === 'enforce': require a valid session.
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (token && (await verifySessionToken(token, nowSeconds))) {
    return NextResponse.next();
  }

  // Unauthenticated. APIs get a clean 401; pages get redirected to login with
  // a `from` so we can return the user where they were headed. Use req.nextUrl
  // (which carries the real external host behind Fly's proxy) rather than a
  // relative Location — middleware parses redirect targets as absolute URLs.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('from', pathname);
  return NextResponse.redirect(url);
}

// Run on everything except Next's static assets and the favicon.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
