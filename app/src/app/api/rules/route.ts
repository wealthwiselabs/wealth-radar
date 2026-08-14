import { NextRequest, NextResponse } from 'next/server';
import { readRules, createRule } from '@/lib/storage';
import { previewRule, applyRule } from '@/lib/ruleBackfill';
import { PatternTooShortError } from '@/lib/ruleErrors';

// GET /api/rules - all rules with their current match impact
export async function GET() {
  try {
    const rules = await readRules();
    const withCounts = rules.map((r) => {
      const p = previewRule({ pattern: r.pattern, categoryId: r.categoryId, subcategoryId: r.subcategoryId });
      return { ...r, totalMatches: p.totalMatches, distinctCategories: p.distinctCategories };
    });
    // Loudest first: the rules most worth reviewing are the ones touching most rows.
    withCounts.sort((a, b) => b.totalMatches - a.totalMatches);
    return NextResponse.json({ rules: withCounts });
  } catch (error) {
    console.error('Error listing rules:', error);
    return NextResponse.json({ error: 'Failed to list rules' }, { status: 500 });
  }
}

// POST /api/rules - create (or update by pattern), optionally backfilling
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      pattern: string; categoryId: string; subcategoryId: string; applyNow?: boolean;
    };
    if (!body.pattern || !body.categoryId || !body.subcategoryId) {
      return NextResponse.json({ error: 'pattern, categoryId and subcategoryId are required' }, { status: 400 });
    }

    const rule = await createRule({
      pattern: body.pattern, categoryId: body.categoryId, subcategoryId: body.subcategoryId,
    });
    const applied = body.applyNow ? applyRule(rule.id) : null;
    return NextResponse.json({ rule, applied });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create rule';
    // Pattern-length rejection is a client error, not a server fault.
    const status = error instanceof PatternTooShortError ? 400 : 500;
    if (status === 500) console.error('Error creating rule:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
