import { NextRequest, NextResponse } from 'next/server';
import { updateRule, deleteRule } from '@/lib/storage';
import { PatternTooShortError, PatternConflictError } from '@/lib/ruleErrors';

interface RouteContext { params: Promise<{ id: string }> }

// PATCH /api/rules/[id]
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Partial<{
      pattern: string; categoryId: string; subcategoryId: string; enabled: boolean;
    }>;
    const rule = await updateRule(id, body);
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    return NextResponse.json({ rule });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update rule';
    const status = error instanceof PatternTooShortError ? 400
      : error instanceof PatternConflictError ? 409
      : 500;
    if (status === 500) console.error('Error updating rule:', error);
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE /api/rules/[id]
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const deleted = await deleteRule(id);
    if (!deleted) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting rule:', error);
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  }
}
