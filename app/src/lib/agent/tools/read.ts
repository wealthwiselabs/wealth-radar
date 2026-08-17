import { readTransactions } from '@/lib/storage';
import { monthlyExpenseTotals } from '@/lib/spending';
import type { Tool } from './types';

// Note: readTransactions() already excludes superseded rows at the SQL level
// (WHERE supersededBy IS NULL) and the Transaction shape it returns has no
// supersededBy field to re-filter on, so there is nothing extra to do here.

export const searchTransactionsTool: Tool = {
  gate: 'none',
  spec: {
    name: 'search_transactions',
    description:
      "Search the user's transactions by a case-insensitive substring of the description, " +
      'optionally within a month (YYYY-MM). Returns up to 50 matching rows.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring to match in the description' },
        month: { type: 'string', description: 'Optional YYYY-MM filter' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  async run(input: { query: string; month?: string }, { db }) {
    const q = (input.query ?? '').toLowerCase();
    const rows = (await readTransactions(db))
      .filter((t) => t.description.toLowerCase().includes(q))
      .filter((t) => (input.month ? t.date.slice(0, 7) === input.month : true))
      .slice(0, 50)
      .map((t) => `${t.date} ${t.description} ${t.amount} [${t.categoryId}/${t.subcategoryId}] id=${t.id}`);
    return { content: rows.length ? rows.join('\n') : 'No matching transactions.' };
  },
};

export const querySpendingTool: Tool = {
  gate: 'none',
  spec: {
    name: 'query_spending',
    description: 'Return total monthly expense per month across all accounts, as an aid to answering spending questions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async run(_input, { db }) {
    const txns = await readTransactions(db);
    const totals = monthlyExpenseTotals(txns);
    const lines = totals.map(({ month, total }) => `${month}: ${total.toFixed(2)}`);
    return { content: lines.length ? lines.join('\n') : 'No expenses recorded.' };
  },
};

export const readTools: Tool[] = [searchTransactionsTool, querySpendingTool];
