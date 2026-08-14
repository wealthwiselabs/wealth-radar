import { NextResponse } from 'next/server';
import { readTaxonomy } from '@/lib/storage';

// GET /api/taxonomy - Get category taxonomy
export async function GET() {
  try {
    const taxonomy = await readTaxonomy();
    return NextResponse.json(taxonomy);
  } catch (error) {
    console.error('Error fetching taxonomy:', error);
    return NextResponse.json(
      { error: 'Failed to fetch taxonomy' },
      { status: 500 }
    );
  }
}
