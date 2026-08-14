// app/src/app/api/investments/import-statement/preview/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { extractStatement } from '@/lib/investments/statementExtract';
import { parseStatementExtraction, buildImportPlan } from '@/lib/investments/statementBackfill';

// POST — dry-run: extract a single investment statement and plan the import.
// Writes nothing. Committing is a separate call.
export async function POST(request: NextRequest) {
  try {
    const { pdfText, fileName } = (await request.json()) as { pdfText?: string; fileName?: string };
    if (!pdfText) return NextResponse.json({ error: 'pdfText is required' }, { status: 400 });

    const apiKey = request.headers.get('x-anthropic-api-key') || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'No Anthropic API key configured', details: 'Set one in Settings or add ANTHROPIC_API_KEY to .env.local.' },
        { status: 401 },
      );
    }

    const client = new Anthropic({ apiKey });
    const statements = parseStatementExtraction(await extractStatement(client, pdfText));
    const plan = buildImportPlan(statements);
    return NextResponse.json({ fileName: fileName ?? '', statements, plan });
  } catch (error) {
    console.error('Statement preview error:', error);
    return NextResponse.json({ error: 'Failed to preview statement', details: String(error) }, { status: 500 });
  }
}
