// app/src/app/api/investments/import-statement/commit/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { snapshotDb } from '@/lib/backup';
import { assertValidStatements, commitStatements } from '@/lib/investments/statementBackfill';

// POST — commit the previewed statements: snapshot the DB, then write.
export async function POST(request: NextRequest) {
  try {
    const { statements } = (await request.json()) as { statements?: unknown };
    try {
      assertValidStatements(statements);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'invalid statements' }, { status: 400 });
    }
    snapshotDb('pre-statement-upload');
    const results = await commitStatements(statements);
    return NextResponse.json({ results });
  } catch (error) {
    console.error('Statement commit error:', error);
    return NextResponse.json({ error: 'Failed to commit statement', details: String(error) }, { status: 500 });
  }
}
