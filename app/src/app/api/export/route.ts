import { NextRequest, NextResponse } from 'next/server';
import { readTransactions } from '@/lib/storage';
import type { ExportFormat } from '@/types';

// GET /api/export?format=csv|json
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const format = (searchParams.get('format') || 'csv') as ExportFormat;
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

    // Sort by date descending
    transactions.sort((a, b) => b.date.localeCompare(a.date));

    const timestamp = new Date().toISOString().split('T')[0];

    if (format === 'json') {
      return new NextResponse(JSON.stringify({ transactions }, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="transactions-${timestamp}.json"`,
        },
      });
    }

    // CSV format
    const headers = [
      'Date',
      'Description',
      'Amount',
      'Bank',
      'Account',
      'Category',
      'Subcategory',
      'Note',
      'Source',
    ];

    const escapeCSV = (value: string): string => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    const rows = transactions.map((t) =>
      [
        t.date,
        escapeCSV(t.description),
        t.amount.toString(),
        escapeCSV(t.bank),
        escapeCSV(t.account),
        t.categoryId,
        t.subcategoryId,
        escapeCSV(t.note),
        escapeCSV(t.source),
      ].join(',')
    );

    const csv = [headers.join(','), ...rows].join('\n');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="transactions-${timestamp}.csv"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: 'Failed to export transactions' },
      { status: 500 }
    );
  }
}
