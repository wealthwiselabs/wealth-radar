import { NextResponse } from 'next/server';
import { isPlaidConfigured } from '@/lib/plaid/config';

export async function GET() {
  return NextResponse.json({
    plaidEnabled: isPlaidConfigured(),
    anthropicEnabled: Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY),
  });
}
