import { NextRequest, NextResponse } from 'next/server';
import { parseHoldingsPaste } from '@/lib/investments/parsePaste';

// POST /api/investments/parse — turn pasted text into holdings rows.
// This route deliberately writes nothing; committing is a separate call.
export async function POST(request: NextRequest) {
  try {
    const { text } = (await request.json()) as { text?: string };
    if (typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    const apiKey = request.headers.get('x-anthropic-api-key') || undefined;
    return NextResponse.json(await parseHoldingsPaste(text, { apiKey }));
  } catch (error) {
    console.error('Error parsing holdings paste:', error);
    return NextResponse.json({ error: 'Failed to parse pasted text' }, { status: 500 });
  }
}
