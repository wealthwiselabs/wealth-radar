import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
  readTransactions,
  addTransactions,
} from '@/lib/storage';
import type { PendingTransaction } from '@/types';

// GET /api/transactions - Fetch all transactions with optional date filter
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let transactions = await readTransactions();

    // Filter by date range if provided
    if (startDate) {
      transactions = transactions.filter((t) => t.date >= startDate);
    }
    if (endDate) {
      transactions = transactions.filter((t) => t.date <= endDate);
    }

    // Sort by date descending (newest first)
    transactions.sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json({ transactions });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transactions' },
      { status: 500 }
    );
  }
}

// POST /api/transactions - Save new transactions (with deduplication)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transactions } = body as {
      transactions: PendingTransaction[];
    };

    if (!transactions || !Array.isArray(transactions)) {
      return NextResponse.json(
        { error: 'transactions array is required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // Add IDs and timestamps. accountId/accountClass are assigned by the DB
    // layer (resolved from bank/account), so they stay absent here.
    const newTransactions: PendingTransaction[] = transactions.map((t) => ({
      ...t,
      id: uuidv4(),
      createdAt: now,
      modifiedAt: now,
    }));

    const { added, skipped } = await addTransactions(newTransactions);

    return NextResponse.json({
      transactions: added,
      skipped,
      message: skipped > 0
        ? `${added.length} transaction(s) added, ${skipped} duplicate(s) skipped`
        : `${added.length} transaction(s) added`,
    });
  } catch (error) {
    console.error('Error saving transactions:', error);
    return NextResponse.json(
      { error: 'Failed to save transactions' },
      { status: 500 }
    );
  }
}
