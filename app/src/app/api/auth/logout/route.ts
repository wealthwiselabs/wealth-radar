import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';

// POST /api/auth/logout — clear the session and return to the login page.
// Relative Location so the proxy's internal host (0.0.0.0:3000) never leaks in.
export async function POST(_req: NextRequest) {
  const res = new NextResponse(null, { status: 303, headers: { Location: '/login' } });
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
