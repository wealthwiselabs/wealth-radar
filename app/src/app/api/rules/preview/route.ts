import { NextRequest, NextResponse } from 'next/server';
import { previewRule } from '@/lib/ruleBackfill';
import { suggestPattern } from '@/lib/patternSuggest';
import { isValidPattern } from '@/lib/categoryRules';

// POST /api/rules/preview - seed a pattern (when only a description is given)
// and report what applying it would do.
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      categoryId: string; subcategoryId: string; pattern?: string; description?: string;
    };
    if (!body.categoryId || !body.subcategoryId) {
      return NextResponse.json({ error: 'categoryId and subcategoryId are required' }, { status: 400 });
    }

    // Seeding is best-effort and never blocks: suggestPattern falls back to a
    // regex heuristic on any failure.
    const pattern = body.pattern ?? (body.description ? await suggestPattern(body.description) : '');
    if (!isValidPattern(pattern)) {
      return NextResponse.json({
        pattern, totalMatches: 0, alreadyCorrect: 0, willChange: 0, skippedManual: 0,
        distinctCategories: 0, warnHighMatchRate: false, warnManyCategories: false,
        samples: [], tooShort: true,
      });
    }

    return NextResponse.json({
      ...previewRule({ pattern, categoryId: body.categoryId, subcategoryId: body.subcategoryId }),
      tooShort: false,
    });
  } catch (error) {
    console.error('Error previewing rule:', error);
    return NextResponse.json({ error: 'Failed to preview rule' }, { status: 500 });
  }
}
