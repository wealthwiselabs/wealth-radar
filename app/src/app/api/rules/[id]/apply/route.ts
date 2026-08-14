import { NextRequest, NextResponse } from 'next/server';
import { applyRule } from '@/lib/ruleBackfill';
import { RuleDisabledError, RuleNotFoundError } from '@/lib/ruleErrors';

interface RouteContext { params: Promise<{ id: string }> }

// POST /api/rules/[id]/apply - backfill existing transactions
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(applyRule(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply rule';
    if (error instanceof RuleNotFoundError) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (error instanceof RuleDisabledError) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error('Error applying rule:', error);
    return NextResponse.json({ error: 'Failed to apply rule' }, { status: 500 });
  }
}
