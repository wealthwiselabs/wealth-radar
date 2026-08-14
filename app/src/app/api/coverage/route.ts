import { NextRequest, NextResponse } from 'next/server';
import { computeCoverage } from '@/lib/coverage';
export async function GET(request: NextRequest) {
  const n = Number(request.nextUrl.searchParams.get('monthsBack')) || 12;
  return NextResponse.json(computeCoverage({ monthsBack: n }));
}
