import { NextRequest, NextResponse } from 'next/server';
import {
  findTransactionById,
  updateTransaction,
  deleteTransaction,
} from '@/lib/storage';
import type { TransactionUpdate } from '@/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/transactions/[id] - Get single transaction
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const transaction = await findTransactionById(id);

    if (!transaction) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ transaction });
  } catch (error) {
    console.error('Error fetching transaction:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transaction' },
      { status: 500 }
    );
  }
}

// PUT /api/transactions/[id] - Update transaction
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as TransactionUpdate;

    const current = await findTransactionById(id);
    if (!current) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    // A hand-set category is protected from every rule from now on. Rule
    // creation is offered separately, by the preview modal in the UI.
    const categoryChanged =
      !!body.categoryId &&
      !!body.subcategoryId &&
      (body.categoryId !== current.categoryId ||
        body.subcategoryId !== current.subcategoryId);

    const updated = await updateTransaction(id, {
      ...body,
      ...(categoryChanged ? { categorySource: 'manual' as const } : {}),
    });

    if (!updated) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ transaction: updated });
  } catch (error) {
    console.error('Error updating transaction:', error);
    return NextResponse.json(
      { error: 'Failed to update transaction' },
      { status: 500 }
    );
  }
}

// DELETE /api/transactions/[id] - Delete transaction
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const deleted = await deleteTransaction(id);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    return NextResponse.json(
      { error: 'Failed to delete transaction' },
      { status: 500 }
    );
  }
}
