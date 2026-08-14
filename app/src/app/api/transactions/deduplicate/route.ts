import { NextResponse } from 'next/server';
import { deduplicateTransactions } from '@/lib/storage';

// POST /api/transactions/deduplicate - Remove duplicate transactions
export async function POST() {
  try {
    const { kept, removed } = await deduplicateTransactions();

    return NextResponse.json({
      success: true,
      kept,
      removed,
      message: removed > 0
        ? `Removed ${removed} duplicate(s), ${kept} transaction(s) remaining`
        : 'No duplicates found',
    });
  } catch (error) {
    console.error('Error deduplicating transactions:', error);
    return NextResponse.json(
      { error: 'Failed to deduplicate transactions' },
      { status: 500 }
    );
  }
}
