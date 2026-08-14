import { NextRequest, NextResponse } from 'next/server';
import { listReserveFlows } from '@/lib/investments/read';

// GET /api/investments/flows?from=&to= — confirmed cash flows for reserve accounts,
// windowed to [from, to]. An empty `from` means "everything so far", not "nothing" —
// it resolves to a floor date rather than being special-cased inside the lib.
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    const today = new Date().toISOString().slice(0, 10);
    const from = q.get('from') || '0000-01-01';
    const to = q.get('to') || today;
    const flows = await listReserveFlows(from, to);
    return NextResponse.json({ flows });
  } catch (error) {
    console.error('Error listing reserve flows:', error);
    return NextResponse.json({ error: 'Failed to list reserve flows' }, { status: 500 });
  }
}
