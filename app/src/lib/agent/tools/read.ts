import { readTransactions } from '@/lib/storage';
import { monthlyExpenseTotals } from '@/lib/spending';
import {
  loadAllocationContext,
  loadPortfolioContext,
  listReserveFlows,
  loadAccountBreakdown,
} from '@/lib/investments/read';
import {
  householdValueAt,
  allocationValueAt,
  buildAllocationWindowTree,
  earliestSnapshotDate,
  nodeTrendSeries,
  type AllocNode,
} from '@/lib/investments/allocation';
import { purposeReturnBetween } from '@/lib/investments/series';
import type { Purpose } from '@/lib/investments/purpose';
import type { Tool } from './types';

const NO_INVESTMENT_DATA = 'No investment data.';

/** Ascending list of distinct snapshot dates; [] when there are no snapshots. */
function snapshotDates(snapshots: { asOf: string }[]): string[] {
  return [...new Set(snapshots.map((s) => s.asOf))].sort();
}

function money(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

export const investmentSummaryTool: Tool = {
  gate: 'none',
  spec: {
    name: 'investment_summary',
    description:
      'Summarize the investment portfolio: total household value at the latest snapshot, ' +
      'the top-level allocation breakdown, and the trailing portfolio return.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async run(_input, { db }) {
    const ctx = await loadAllocationContext(db);
    const dates = snapshotDates(ctx.snapshots);
    if (dates.length === 0) return { content: NO_INVESTMENT_DATA };

    const latest = dates[dates.length - 1];
    const total = householdValueAt(ctx, latest);

    const lines: string[] = [];
    lines.push(
      total === null
        ? `Portfolio value as of ${latest}: unknown (a snapshot is missing complete holdings)`
        : `Portfolio value as of ${latest}: ${money(total)}`,
    );

    // Top-level allocation buckets are the path keys with no separator.
    const alloc = allocationValueAt(ctx, latest);
    const tops = [...alloc.entries()]
      .filter(([key]) => !key.includes('\t'))
      .sort((a, b) => b[1] - a[1]);
    if (tops.length) {
      lines.push('Allocation:');
      for (const [name, value] of tops) lines.push(`  ${name}: ${money(value)}`);
    }

    // Trailing return across the full snapshot window.
    const first = dates[0];
    const r = purposeReturnBetween(
      ctx.snapshots, ctx.accountPurposes, ctx.overrides, ctx.flows, 'portfolio', first, latest,
    );
    lines.push(
      r.kind === 'ok'
        ? `Trailing return ${first} to ${latest}: ${(r.value * 100).toFixed(2)}%`
        : `Trailing return ${first} to ${latest}: unavailable (${r.reason})`,
    );

    return { content: lines.join('\n') };
  },
};

export const listInvestmentTransactionsTool: Tool = {
  gate: 'none',
  spec: {
    name: 'list_investment_transactions',
    description:
      'List recent investment activity (contributions, withdrawals, buys, sells). ' +
      'Optionally filter by account (id or label substring), date range (from/to, YYYY-MM-DD), ' +
      'or type. Returns up to 50 rows, newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Account id or case-insensitive label substring' },
        from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD' },
        to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD' },
        type: { type: 'string', description: 'Transaction type filter (e.g. buy, sell, cash)' },
      },
      additionalProperties: false,
    },
  },
  async run(input: { account?: string; from?: string; to?: string; type?: string }, { db }) {
    const ctx = await loadAllocationContext(db);
    if (ctx.exchanges.length === 0) return { content: NO_INVESTMENT_DATA };

    const acct = (input.account ?? '').toLowerCase();
    const typeFilter = (input.type ?? '').toLowerCase();

    const rows = ctx.exchanges
      .filter((t) => {
        if (!acct) return true;
        const label = (ctx.accountLabels.get(t.accountId) ?? '').toLowerCase();
        return t.accountId.toLowerCase() === acct || label.includes(acct);
      })
      .filter((t) => (input.from ? t.date >= input.from : true))
      .filter((t) => (input.to ? t.date <= input.to : true))
      .filter((t) => (typeFilter ? (t.type ?? '').toLowerCase() === typeFilter : true))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 50)
      .map((t) => {
        const label = ctx.accountLabels.get(t.accountId) ?? t.accountId;
        const name = t.name ? ` ${t.name}` : '';
        return `${t.date} ${label} ${t.type} ${money(t.amount)}${name}`;
      });

    return { content: rows.length ? rows.join('\n') : 'No matching investment transactions.' };
  },
};

export const queryInvestmentReturnsTool: Tool = {
  gate: 'none',
  spec: {
    name: 'query_investment_returns',
    description:
      'Compute the day-weighted (Modified Dietz) return over a period. Optionally filter by ' +
      'date range (from/to, YYYY-MM-DD), purpose (portfolio, reserve, insurance, education), ' +
      'or account (id). Defaults to the full snapshot window for the portfolio.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD' },
        to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD' },
        purpose: { type: 'string', description: 'portfolio | reserve | insurance | education' },
        account: { type: 'string', description: 'Restrict to a single account id' },
      },
      additionalProperties: false,
    },
  },
  async run(input: { from?: string; to?: string; purpose?: string; account?: string }, { db }) {
    const base = await loadPortfolioContext(db);
    let snapshots = base.snapshots;
    let flows = base.flows;
    if (input.account) {
      snapshots = snapshots.filter((s) => s.accountId === input.account);
      flows = flows.filter((f) => f.accountId === input.account);
    }
    const dates = snapshotDates(snapshots);
    if (dates.length === 0) return { content: NO_INVESTMENT_DATA };

    const purpose = (input.purpose ?? 'portfolio') as Purpose;
    const from = input.from ?? dates[0];
    const to = input.to ?? dates[dates.length - 1];

    const r = purposeReturnBetween(
      snapshots, base.accountPurposes, base.overrides, flows, purpose, from, to,
    );
    const scope = input.account ? ` for account ${input.account}` : '';
    return {
      content:
        r.kind === 'ok'
          ? `${purpose} return ${from} to ${to}${scope}: ${(r.value * 100).toFixed(2)}%`
          : `${purpose} return ${from} to ${to}${scope}: unavailable (${r.reason})`,
    };
  },
};

export const queryReserveTool: Tool = {
  gate: 'none',
  spec: {
    name: 'query_reserve',
    description:
      'Report the reserve (cash reserve) balance at the latest snapshot and list reserve ' +
      'cash flows over an optional date range (from/to, YYYY-MM-DD).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD' },
        to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD' },
      },
      additionalProperties: false,
    },
  },
  async run(input: { from?: string; to?: string }, { db }) {
    const from = input.from ?? '0000-01-01';
    const to = input.to ?? '9999-12-31';

    const ctx = await loadAllocationContext(db);
    const flows = await listReserveFlows(from, to, db);
    const dates = snapshotDates(ctx.snapshots);

    // Reserve balance carried forward to the latest snapshot date.
    const balance = dates.length ? householdValueAt(ctx, dates[dates.length - 1], ['reserve']) : null;

    if (balance === null && flows.length === 0) return { content: NO_INVESTMENT_DATA };

    const lines: string[] = [];
    lines.push(
      balance === null
        ? 'Reserve balance: unknown'
        : `Reserve balance as of ${dates[dates.length - 1]}: ${money(balance)}`,
    );
    if (flows.length) {
      lines.push(`Reserve flows ${from} to ${to}:`);
      for (const f of flows) {
        const note = f.note ? ` ${f.note}` : '';
        lines.push(`  ${f.date} ${f.accountLabel} ${f.kind} ${money(f.amount)}${note}`);
      }
    } else {
      lines.push('No reserve flows in range.');
    }

    return { content: lines.join('\n') };
  },
};

function fmtReturn(r: { kind: 'ok'; value: number } | { kind: 'missing'; reason: string }): string {
  return r.kind === 'ok' ? `${(r.value * 100).toFixed(2)}%` : `n/a (${r.reason})`;
}

export const getHoldingsBreakdownTool: Tool = {
  gate: 'none',
  spec: {
    name: 'get_holdings_breakdown',
    description:
      'Show the per-account investment breakdown that appears in the Holdings table: each ' +
      "account's start/end value and return, its holdings (ticker, value, % of account, return), " +
      'and recent transactions. Optionally filter by account (id or "all") and date range (from/to, YYYY-MM-DD).',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Account id, or "all" (default)' },
        from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD' },
        to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD' },
      },
      additionalProperties: false,
    },
  },
  async run(input: { account?: string; from?: string; to?: string }, { db }) {
    const scope = input.account && input.account.trim() ? input.account.trim() : 'all';
    const { breakdown } = await loadAccountBreakdown(scope, input.from, input.to, db);
    if (breakdown.length === 0) return { content: NO_INVESTMENT_DATA };

    const lines: string[] = [];
    for (const acct of breakdown) {
      const end = acct.endValue === null ? 'unknown' : money(acct.endValue);
      lines.push(`${acct.accountName} [${acct.accountPurpose}] — value ${end} as of ${acct.endAsOf ?? 'n/a'}, return ${fmtReturn(acct.roi)}`);
      for (const h of acct.holdings.slice(0, 15)) {
        const tick = h.ticker ?? h.name;
        lines.push(`  ${tick}: ${money(h.value)} (${(h.pct * 100).toFixed(1)}%) return ${fmtReturn(h.roi)}`);
      }
      if (acct.transactions.length) {
        lines.push('  Recent transactions:');
        for (const t of acct.transactions.slice(0, 15)) {
          const tick = t.ticker ? ` ${t.ticker}` : '';
          lines.push(`    ${t.date} ${t.type}${tick} ${money(t.amount)}`);
        }
      }
    }
    return { content: lines.join('\n') };
  },
};

function renderAllocNode(node: AllocNode, lines: string[]): void {
  const indent = '  '.repeat(node.depth);
  const bal = node.balance === null ? 'unknown' : money(node.balance);
  const pct = node.pctOfTotal === null ? '' : ` (${(node.pctOfTotal * 100).toFixed(1)}%)`;
  lines.push(`${indent}${node.label}: ${bal}${pct} return ${fmtReturn(node.roi)}`);
  for (const child of node.children) renderAllocNode(child, lines);
}

export const getAllocationBreakdownTool: Tool = {
  gate: 'none',
  spec: {
    name: 'get_allocation_breakdown',
    description:
      'Show the nested asset-allocation tree that appears in the Allocation panel: each bucket ' +
      'and sub-bucket with its balance, share of total, and return over a window (from/to, YYYY-MM-DD; ' +
      'defaults to the earliest snapshot through today).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD' },
        to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD' },
      },
      additionalProperties: false,
    },
  },
  async run(input: { from?: string; to?: string }, { db }) {
    const ctx = await loadAllocationContext(db);
    if (ctx.snapshots.length === 0) return { content: NO_INVESTMENT_DATA };
    const today = new Date().toISOString().slice(0, 10);
    const from = input.from || earliestSnapshotDate(ctx, today);
    const to = input.to || today;
    const tree = buildAllocationWindowTree(ctx, from, to);
    const lines: string[] = [];
    renderAllocNode(tree, lines);
    return { content: lines.join('\n') };
  },
};

export const getPortfolioTrendTool: Tool = {
  gate: 'none',
  spec: {
    name: 'get_portfolio_trend',
    description:
      'Return the value/return time series behind the portfolio trend chart. Optionally target a ' +
      'purpose (portfolio | reserve | insurance | education) or an allocation node path (slash-delimited, ' +
      'e.g. "Stock/US"), choose basis (monthly | quarterly | yearly, default quarterly), a date range ' +
      '(from/to, YYYY-MM-DD), and metric (value | roi, default value).',
    inputSchema: {
      type: 'object',
      properties: {
        purpose: { type: 'string', description: 'portfolio | reserve | insurance | education' },
        path: { type: 'string', description: 'Slash-delimited allocation node path' },
        basis: { type: 'string', description: 'monthly | quarterly | yearly' },
        from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD' },
        to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD' },
        metric: { type: 'string', description: 'value | roi' },
      },
      additionalProperties: false,
    },
  },
  async run(input: { purpose?: string; path?: string; basis?: string; from?: string; to?: string; metric?: string }, { db }) {
    const ctx = await loadAllocationContext(db);
    if (ctx.snapshots.length === 0) return { content: NO_INVESTMENT_DATA };

    const today = new Date().toISOString().slice(0, 10);
    const basis = (['monthly', 'quarterly', 'yearly'].includes(input.basis ?? '') ? input.basis : 'quarterly') as 'monthly' | 'quarterly' | 'yearly';
    const path = input.path ? input.path.split('/').filter(Boolean) : [];
    const targets = (input.purpose ? [input.purpose] : ['portfolio']) as Purpose[];
    const from = input.from || earliestSnapshotDate(ctx, today);
    const to = input.to || today;
    const metric = input.metric === 'roi' ? 'roi' : 'value';

    const points = nodeTrendSeries(ctx, path, basis, from, to, targets).filter((p) => p.startDate <= today);
    if (points.length === 0) return { content: 'No trend data in range.' };

    const lines = points.map((p) => {
      if (metric === 'roi') {
        return `${p.label}: ${p.roi === null ? 'n/a' : `${(p.roi * 100).toFixed(2)}%`}`;
      }
      return `${p.label}: ${p.value === null ? 'unknown' : money(p.value)}`;
    });
    return { content: lines.join('\n') };
  },
};

export const readTools: Tool[] = [
  searchTransactionsTool,
  querySpendingTool,
  investmentSummaryTool,
  listInvestmentTransactionsTool,
  queryInvestmentReturnsTool,
  queryReserveTool,
  getHoldingsBreakdownTool,
  getAllocationBreakdownTool,
  getPortfolioTrendTool,
];
