# AI Advisor Full Page Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI advisor visibility into every section rendered on the current page (via one-line summaries in `<current_view>`) plus on-demand read tools to pull the full/live data for holdings, allocation, trend, and transactions.

**Architecture:** The client view-context store becomes a *base snapshot + section registry* so self-fetching child components contribute their own summaries without lifting data. The server formatter renders those section summaries — each naming the tool + args to fetch its detail — into `<current_view>`. Four new `gate:'none'` read tools (plus paging on one existing tool) return the full data on demand by calling `@/lib/investments/*` and storage helpers directly.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, SQLite + Drizzle, vitest. Agent tools follow the `Tool` contract in `app/src/lib/agent/tools/types.ts`.

**Spec:** `docs/superpowers/specs/2026-08-19-agent-page-visibility-design.md`

## Global Constraints

- Tests use `makeTmpDb()` from `@/test/tmpDb` — never the production DB. Import: `import { makeTmpDb } from '@/test/tmpDb';` then `const { db } = makeTmpDb();`.
- Read tools: `gate: 'none'`, `run(input, ctx)` returns `{ content: string }`, `ctx` is `{ db }`. Every `inputSchema` is a JSON-Schema object with `additionalProperties: false`.
- Agent tools call `@/lib/*` helpers directly — no raw `db.select` inside a tool.
- Tools receive `db` in ctx and MUST pass it explicitly to lib helpers (e.g. `loadAllocationContext(db)`); the helpers default to `getDb()` only for API routes.
- `Purpose = 'portfolio' | 'reserve' | 'insurance' | 'education'`.
- Run from `app/`: `npx vitest run <file>`, `npx tsc --noEmit`, `npm run build`.
- Commit per task on the current feature branch `claude/ai-advisor-page-visibility-4a519f`.

---

### Task 1: View-context store — base + section registry + formatter

**Files:**
- Modify: `app/src/app/lib/viewContext.ts` (whole file rewritten)
- Test: `app/src/app/lib/__tests__/viewContext.test.ts`

**Interfaces:**
- Produces: `ViewSection`, `ViewSnapshot` (now with `sections?`), `ViewBase = Omit<ViewSnapshot,'sections'>`; store fns `setViewBase(b: ViewBase|null)`, `setViewSection(s: ViewSection)`, `removeViewSection(id: string)`, `getViewContext(): ViewSnapshot|null`, `subscribe(fn)`, `formatViewContext(s)`.

- [ ] **Step 1: Replace the test file with registry + formatter tests**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatViewContext, getViewContext, setViewBase, setViewSection, removeViewSection,
  type ViewSnapshot,
} from '@/app/lib/viewContext';

const base = { route: '/investments', label: 'Investments', highlights: [{ label: 'Portfolio', value: '$1' }] };

describe('view-context registry', () => {
  beforeEach(() => setViewBase(null));

  it('returns null with no base', () => {
    expect(getViewContext()).toBeNull();
  });

  it('merges base with registered sections, ordered by order then id', () => {
    setViewBase(base);
    setViewSection({ id: 'b', order: 2, title: 'B', summary: 'b' });
    setViewSection({ id: 'a', order: 1, title: 'A', summary: 'a' });
    const snap = getViewContext()!;
    expect(snap.route).toBe('/investments');
    expect(snap.sections!.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('removes a section on removeViewSection', () => {
    setViewBase(base);
    setViewSection({ id: 'a', title: 'A', summary: 'a' });
    removeViewSection('a');
    expect(getViewContext()!.sections).toEqual([]);
  });

  it('clears sections when the route changes', () => {
    setViewBase(base);
    setViewSection({ id: 'a', title: 'A', summary: 'a' });
    setViewBase({ route: '/', label: 'Home', highlights: [] });
    expect(getViewContext()!.sections).toEqual([]);
  });

  it('keeps sections when the same route re-publishes its base', () => {
    setViewBase(base);
    setViewSection({ id: 'a', title: 'A', summary: 'a' });
    setViewBase({ ...base, timeRange: 'YTD' });
    expect(getViewContext()!.sections!.map((s) => s.id)).toEqual(['a']);
  });
});

describe('formatViewContext', () => {
  it('returns empty string for null', () => {
    expect(formatViewContext(null)).toBe('');
  });

  it('names the view and caps highlights at 8', () => {
    const snap: ViewSnapshot = {
      route: '/', label: 'Home',
      highlights: Array.from({ length: 10 }, (_, i) => ({ label: `h${i}`, value: `${i}` })),
    };
    const out = formatViewContext(snap);
    expect(out).toContain('Home');
    expect((out.match(/- h\d/g) || []).length).toBe(8);
  });

  it('renders sections with a detail hint including args', () => {
    const snap: ViewSnapshot = {
      route: '/investments', label: 'Investments', highlights: [],
      sections: [{
        id: 'investments.holdings', title: 'Holdings breakdown', summary: '3 accounts, $412k',
        detail: { tool: 'get_holdings_breakdown', args: { account: 'all' } },
      }],
    };
    const out = formatViewContext(snap);
    expect(out).toContain('Sections on screen');
    expect(out).toContain('- Holdings breakdown: 3 accounts, $412k [details: get_holdings_breakdown {"account":"all"}]');
  });

  it('renders a summary-only section without a hint, and omits empty args', () => {
    const snap: ViewSnapshot = {
      route: '/', label: 'Home', highlights: [],
      sections: [
        { id: 'x', title: 'X', summary: 'plain' },
        { id: 'y', title: 'Y', summary: 'y', detail: { tool: 'query_spending' } },
      ],
    };
    const out = formatViewContext(snap);
    expect(out).toContain('- X: plain');
    expect(out).not.toContain('[details:'.concat(' ]'));
    expect(out).toContain('- Y: y [details: query_spending]');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run src/app/lib/__tests__/viewContext.test.ts`
Expected: FAIL (no `setViewBase`/`getViewContext` registry behavior; `sections` unrendered).

- [ ] **Step 3: Rewrite `app/src/app/lib/viewContext.ts`**

```ts
export interface ViewSection {
  id: string;
  order?: number;
  title: string;
  summary: string;
  detail?: { tool: string; args?: Record<string, unknown> };
}

export interface ViewSnapshot {
  route: string;
  label: string;
  timeRange?: string;
  filters?: Record<string, string>;
  highlights: { label: string; value: string }[];
  sections?: ViewSection[];
}

export type ViewBase = Omit<ViewSnapshot, 'sections'>;

let base: ViewBase | null = null;
const sections = new Map<string, ViewSection>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

/** Publish the page-level base. A route change resets sections so stale
 *  sections from the previous page cannot leak. Passing null clears everything. */
export function setViewBase(b: ViewBase | null): void {
  if (b === null) {
    base = null;
    sections.clear();
    notify();
    return;
  }
  if (!base || base.route !== b.route) sections.clear();
  base = b;
  notify();
}

export function setViewSection(section: ViewSection): void {
  sections.set(section.id, section);
  notify();
}

export function removeViewSection(id: string): void {
  if (sections.delete(id)) notify();
}

export function getViewContext(): ViewSnapshot | null {
  if (!base) return null;
  const list = [...sections.values()].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
  );
  return { ...base, sections: list };
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const MAX_HIGHLIGHTS = 8;
const MAX_SECTIONS = 12;
const MAX_SUMMARY_LEN = 160;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function formatViewContext(s: ViewSnapshot | null): string {
  if (!s) return '';

  const lines: string[] = [];
  lines.push(`The user is viewing ${s.label} (${s.route})`);

  if (s.timeRange) lines.push(`Time range: ${s.timeRange}`);

  if (s.filters && Object.keys(s.filters).length > 0) {
    const filterStr = Object.entries(s.filters).map(([k, v]) => `${k}=${v}`).join(', ');
    lines.push(`Filters: ${filterStr}`);
  }

  if (s.highlights.length > 0) {
    lines.push('Highlights:');
    for (const h of s.highlights.slice(0, MAX_HIGHLIGHTS)) lines.push(`- ${h.label}: ${h.value}`);
  }

  if (s.sections && s.sections.length > 0) {
    lines.push('Sections on screen (call the referenced tool to load full or updated data):');
    for (const sec of s.sections.slice(0, MAX_SECTIONS)) {
      const summary = truncate(sec.summary, MAX_SUMMARY_LEN);
      let hint = '';
      if (sec.detail) {
        const args = sec.detail.args && Object.keys(sec.detail.args).length > 0
          ? ` ${JSON.stringify(sec.detail.args)}`
          : '';
        hint = ` [details: ${sec.detail.tool}${args}]`;
      }
      lines.push(`- ${sec.title}: ${summary}${hint}`);
    }
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run src/app/lib/__tests__/viewContext.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/app/lib/viewContext.ts app/src/app/lib/__tests__/viewContext.test.ts
git commit -m "feat(agent): view-context section registry + section rendering"
```

---

### Task 2: Hooks — retarget publisher, add `usePublishSection`

**Files:**
- Modify: `app/src/app/hooks/usePublishViewContext.ts`
- Create: `app/src/app/hooks/usePublishSection.ts`

**Interfaces:**
- Consumes: `setViewBase`, `setViewSection`, `removeViewSection`, `ViewSection` from Task 1.
- Produces: `usePublishSection(section: ViewSection | null): void`.

- [ ] **Step 1: Retarget `usePublishViewContext.ts` to the base setter**

Replace the import + effect body (keep the value-compare dependency):

```ts
'use client';

import { useEffect } from 'react';
import { setViewBase, type ViewSnapshot } from '@/app/lib/viewContext';

/**
 * Publish the page-level base snapshot (route, label, highlights, filters) to the
 * shared view-context store. Sections are published separately by the components
 * that render them (see usePublishSection). Republishes when the snapshot's
 * contents change (compared by value) and clears the base on unmount.
 */
export function usePublishViewContext(snapshot: ViewSnapshot | null): void {
  useEffect(() => {
    setViewBase(snapshot);
    return () => setViewBase(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compare snapshot by value, not identity, so an inline object doesn't republish every render.
  }, [JSON.stringify(snapshot)]);
}
```

- [ ] **Step 2: Create `app/src/app/hooks/usePublishSection.ts`**

```ts
'use client';

import { useEffect } from 'react';
import { setViewSection, removeViewSection, type ViewSection } from '@/app/lib/viewContext';

/**
 * Register this section's summary into the shared view context so the agent can
 * see it in <current_view> and knows which tool pulls its full data. Pass null
 * while the section has no data yet (loading/error) to omit it. Removes the
 * section on unmount. Compared by value so an inline object doesn't churn.
 */
export function usePublishSection(section: ViewSection | null): void {
  useEffect(() => {
    if (!section) return;
    setViewSection(section);
    return () => removeViewSection(section.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compare by value, not identity.
  }, [JSON.stringify(section)]);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: PASS (no type errors; `getViewContext` consumer `useAgentChat` unchanged).

- [ ] **Step 4: Commit**

```bash
git add app/src/app/hooks/usePublishViewContext.ts app/src/app/hooks/usePublishSection.ts
git commit -m "feat(agent): usePublishSection hook; publisher targets base setter"
```

---

### Task 3: `loadAccountBreakdown` helper + route refactor + `get_holdings_breakdown` tool

**Files:**
- Modify: `app/src/lib/investments/read.ts` (add `loadAccountBreakdown`)
- Modify: `app/src/app/api/investments/breakdown/route.ts` (call the helper)
- Modify: `app/src/lib/agent/tools/read.ts` (add `getHoldingsBreakdownTool`, register)
- Modify: `app/src/lib/agent/tools/__tests__/` → create `holdingsBreakdownTool.test.ts`
- Modify: `app/src/lib/agent/__tests__/readTools.test.ts` (expected names list)

**Interfaces:**
- Produces: `loadAccountBreakdown(scope: string, from: string | undefined, to: string | undefined, db?): Promise<{ breakdown: AccountBreakdown[]; accounts: { id: string; name: string; purpose: Purpose }[] }>`; `getHoldingsBreakdownTool: Tool` (name `get_holdings_breakdown`).
- Consumes: `assembleBreakdown`, `AccountBreakdown`, `RawTxn`, `SecurityMeta` from `@/lib/investments/breakdown`; `listSnapshots` (already imported in read.ts); `PurposeOverride, Purpose` from `@/lib/investments/purpose`; `FlowRow` from `@/lib/investments/transfers`.

- [ ] **Step 1: Add `loadAccountBreakdown` to `app/src/lib/investments/read.ts`**

Add these imports at the top (alongside existing ones):

```ts
import { assembleBreakdown, type AccountBreakdown, type RawTxn, type SecurityMeta } from '@/lib/investments/breakdown';
import type { PurposeOverride } from '@/lib/investments/purpose';
import type { FlowRow } from '@/lib/investments/transfers';
```

Append the helper (uses in-memory `.filter` to avoid extra drizzle operator imports; mirrors the current route logic):

```ts
/**
 * Assemble the per-account investment breakdown (holdings + transactions) over a
 * window. `scope` is an account id or 'all'. `from`/`to` default to the earliest
 * snapshot and today. Shared by the breakdown API route and the agent tool.
 */
export async function loadAccountBreakdown(
  scope: string,
  from: string | undefined,
  to: string | undefined,
  db: Db = getDb(),
): Promise<{ breakdown: AccountBreakdown[]; accounts: { id: string; name: string; purpose: Purpose }[] }> {
  const snapshots = await listSnapshots(null, db);
  const today = new Date().toISOString().slice(0, 10);
  const resolvedFrom = from || (snapshots.length ? [...snapshots].map((s) => s.asOf).sort()[0] : today);
  const resolvedTo = to || today;

  const accounts = db.select().from(schema.accounts).all()
    .filter((a) => a.accountClass === 'investment')
    .map((a) => ({ id: a.id, name: `${a.institution} · ${a.name}`, purpose: (a.purpose ?? 'portfolio') as Purpose }));

  const overrides: PurposeOverride[] = db.select().from(schema.securityPurposes).all()
    .map((o) => ({ accountId: o.accountId, securityId: o.securityId, purpose: o.purpose as Purpose }));

  const flows: FlowRow[] = db.select().from(schema.cashFlows).all()
    .filter((f) => f.confirmed && f.supersededBy == null)
    .map((f) => ({ id: f.id, accountId: f.accountId, date: f.date, amount: f.amount, kind: f.kind, securityId: f.securityId ?? null }));

  const securities = new Map<string, SecurityMeta>(
    db.select().from(schema.securities).all().map((s) => [s.id, {
      ticker: s.ticker, name: s.name, assetType: s.assetType, region: s.region, cap: s.cap, style: s.style, sector: s.sector, kind: s.kind,
    }]),
  );

  const transactions: RawTxn[] = db.select().from(schema.investmentTransactions).all()
    .map((t) => ({ id: t.id, accountId: t.accountId, date: t.date, type: t.type, subtype: t.subtype, securityId: t.securityId ?? null, amount: t.amount }));

  const breakdown = assembleBreakdown({
    from: resolvedFrom, to: resolvedTo, scope, accounts, overrides, snapshots, flows, securities, transactions,
  });
  return { breakdown, accounts };
}
```

- [ ] **Step 2: Refactor `app/src/app/api/investments/breakdown/route.ts` to use the helper**

Replace the body of `GET` with:

```ts
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const scope = request.nextUrl.searchParams.get('account') || 'all';
    const from = request.nextUrl.searchParams.get('from') || undefined;
    const to = request.nextUrl.searchParams.get('to') || undefined;
    const { breakdown, accounts } = await loadAccountBreakdown(scope, from, to, db);
    return NextResponse.json({ breakdown, accounts });
  } catch (error) {
    console.error('Error building investment breakdown:', error);
    return NextResponse.json({ error: 'Failed to build breakdown' }, { status: 500 });
  }
}
```

Update imports: remove the now-unused ones (`assembleBreakdown`, `SecurityMeta`, `PurposeOverride`, `FlowRow`, `RawTxn`, `listSnapshots`, `schema`, drizzle `eq`/`and`/`isNull`, `Purpose` if now unused) and add `import { loadAccountBreakdown } from '@/lib/investments/read';`. Keep `NextRequest, NextResponse` and `getDb`. Verify by typecheck in Step 6.

- [ ] **Step 3: Write the failing tool test — `app/src/lib/agent/tools/__tests__/holdingsBreakdownTool.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, cashFlows, investmentTransactions } from '@/db/schema';
import { commitSnapshot } from '@/lib/investments/snapshots';
import { getHoldingsBreakdownTool } from '@/lib/agent/tools/read';

const NOW = '2026-08-03T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function seedAccount(db: Db, id: string, over: Record<string, unknown> = {}) {
  db.insert(accounts).values({
    id, name: id, institution: 'Bank', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    createdAt: NOW, modifiedAt: NOW, ...over,
  }).run();
}

async function seed(db: Db) {
  seedAccount(db, 'brk', { name: 'Brokerage', institution: 'Fidelity' });
  await commitSnapshot({
    accountId: 'brk', asOf: '2026-06-30', source: 'manual', totalValue: 10000,
    holdings: [{ ticker: 'VTI', name: 'Vanguard Total', quantity: null, value: 10000, assetType: 'equity', kind: 'etf' }],
  }, db);
  await commitSnapshot({
    accountId: 'brk', asOf: '2026-07-31', source: 'manual', totalValue: 11000,
    holdings: [{ ticker: 'VTI', name: 'Vanguard Total', quantity: null, value: 11000, assetType: 'equity', kind: 'etf' }],
  }, db);
  db.insert(investmentTransactions).values({
    id: 'it1', accountId: 'brk', plaidInvestmentTxnId: 'p1', securityId: null,
    date: '2026-07-20', name: 'Buy VTI', amount: 2500, type: 'buy', createdAt: NOW, modifiedAt: NOW,
  }).run();
}

describe('get_holdings_breakdown tool', () => {
  it('is a read-only tool', () => {
    expect(getHoldingsBreakdownTool.gate).toBe('none');
    expect(getHoldingsBreakdownTool.spec.name).toBe('get_holdings_breakdown');
  });

  it('reports holdings and the end value for an account', async () => {
    const { db } = makeTmpDb();
    await seed(db);
    const { content } = await getHoldingsBreakdownTool.run({ account: 'all' }, { db });
    expect(content).toContain('Brokerage');
    expect(content).toContain('VTI');
    expect(content).toContain('11,000');
  });

  it('returns a no-data message on an empty db', async () => {
    const { db } = makeTmpDb();
    const { content } = await getHoldingsBreakdownTool.run({}, { db });
    expect(content).toContain('No investment');
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd app && npx vitest run src/lib/agent/tools/__tests__/holdingsBreakdownTool.test.ts`
Expected: FAIL (`getHoldingsBreakdownTool` is not exported).

- [ ] **Step 5: Add the tool to `app/src/lib/agent/tools/read.ts`**

Add import near the top:

```ts
import { loadAccountBreakdown } from '@/lib/investments/read';
```

Add the tool (before the `readTools` array):

```ts
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
```

Register it in the `readTools` array (add `getHoldingsBreakdownTool,`).

- [ ] **Step 6: Run tool test + typecheck**

Run: `cd app && npx vitest run src/lib/agent/tools/__tests__/holdingsBreakdownTool.test.ts && npx tsc --noEmit`
Expected: PASS both (typecheck confirms the route refactor imports are clean).

- [ ] **Step 7: Update the tool-registry test expectation**

In `app/src/lib/agent/__tests__/readTools.test.ts`, add `'get_holdings_breakdown'` to the expected sorted names list (keep the array sorted).

Run: `cd app && npx vitest run src/lib/agent/__tests__/readTools.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/investments/read.ts app/src/app/api/investments/breakdown/route.ts app/src/lib/agent/tools/read.ts app/src/lib/agent/tools/__tests__/holdingsBreakdownTool.test.ts app/src/lib/agent/__tests__/readTools.test.ts
git commit -m "feat(agent): get_holdings_breakdown tool + shared loadAccountBreakdown"
```

---

### Task 4: `get_allocation_breakdown` tool

**Files:**
- Modify: `app/src/lib/agent/tools/read.ts`
- Create: `app/src/lib/agent/tools/__tests__/allocationBreakdownTool.test.ts`
- Modify: `app/src/lib/agent/__tests__/readTools.test.ts`

**Interfaces:**
- Produces: `getAllocationBreakdownTool: Tool` (name `get_allocation_breakdown`).
- Consumes: `loadAllocationContext` (already imported in read.ts), `buildAllocationWindowTree`, `earliestSnapshotDate`, `AllocNode` from `@/lib/investments/allocation`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts } from '@/db/schema';
import { commitSnapshot } from '@/lib/investments/snapshots';
import { getAllocationBreakdownTool } from '@/lib/agent/tools/read';

const NOW = '2026-08-03T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

async function seed(db: Db) {
  db.insert(accounts).values({
    id: 'brk', name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    createdAt: NOW, modifiedAt: NOW,
  }).run();
  await commitSnapshot({
    accountId: 'brk', asOf: '2026-06-30', source: 'manual', totalValue: 10000,
    holdings: [{ ticker: 'VTI', name: 'Vanguard Total', quantity: null, value: 10000, assetType: 'equity', kind: 'etf' }],
  }, db);
  await commitSnapshot({
    accountId: 'brk', asOf: '2026-07-31', source: 'manual', totalValue: 11000,
    holdings: [{ ticker: 'VTI', name: 'Vanguard Total', quantity: null, value: 11000, assetType: 'equity', kind: 'etf' }],
  }, db);
}

describe('get_allocation_breakdown tool', () => {
  it('is a read-only tool', () => {
    expect(getAllocationBreakdownTool.gate).toBe('none');
    expect(getAllocationBreakdownTool.spec.name).toBe('get_allocation_breakdown');
  });

  it('renders the allocation tree with balances', async () => {
    const { db } = makeTmpDb();
    await seed(db);
    const { content } = await getAllocationBreakdownTool.run({}, { db });
    expect(content).toContain('11,000');
    expect(content.toLowerCase()).toContain('equity');
  });

  it('returns a no-data message on an empty db', async () => {
    const { db } = makeTmpDb();
    const { content } = await getAllocationBreakdownTool.run({}, { db });
    expect(content).toContain('No investment');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/lib/agent/tools/__tests__/allocationBreakdownTool.test.ts`
Expected: FAIL (`getAllocationBreakdownTool` not exported).

- [ ] **Step 3: Add the tool to `read.ts`**

Add imports:

```ts
import { buildAllocationWindowTree, earliestSnapshotDate, type AllocNode } from '@/lib/investments/allocation';
```

Add the tool (before `readTools`):

```ts
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
```

Register `getAllocationBreakdownTool,` in the `readTools` array.

- [ ] **Step 4: Run test + add registry name**

Run: `cd app && npx vitest run src/lib/agent/tools/__tests__/allocationBreakdownTool.test.ts`
Expected: PASS

Add `'get_allocation_breakdown'` to the expected names in `readTools.test.ts`, then:
Run: `cd app && npx vitest run src/lib/agent/__tests__/readTools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/agent/tools/read.ts app/src/lib/agent/tools/__tests__/allocationBreakdownTool.test.ts app/src/lib/agent/__tests__/readTools.test.ts
git commit -m "feat(agent): get_allocation_breakdown tool"
```

---

### Task 5: `get_portfolio_trend` tool

**Files:**
- Modify: `app/src/lib/agent/tools/read.ts`
- Create: `app/src/lib/agent/tools/__tests__/portfolioTrendTool.test.ts`
- Modify: `app/src/lib/agent/__tests__/readTools.test.ts`

**Interfaces:**
- Produces: `getPortfolioTrendTool: Tool` (name `get_portfolio_trend`).
- Consumes: `nodeTrendSeries` from `@/lib/investments/allocation`; `earliestSnapshotDate` (imported in Task 4); `Purpose`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts } from '@/db/schema';
import { commitSnapshot } from '@/lib/investments/snapshots';
import { getPortfolioTrendTool } from '@/lib/agent/tools/read';

const NOW = '2026-08-03T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

async function seed(db: Db) {
  db.insert(accounts).values({
    id: 'brk', name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    createdAt: NOW, modifiedAt: NOW,
  }).run();
  await commitSnapshot({ accountId: 'brk', asOf: '2026-05-31', source: 'manual', totalValue: 9000,
    holdings: [{ ticker: 'VTI', name: 'V', quantity: null, value: 9000, assetType: 'equity', kind: 'etf' }] }, db);
  await commitSnapshot({ accountId: 'brk', asOf: '2026-06-30', source: 'manual', totalValue: 10000,
    holdings: [{ ticker: 'VTI', name: 'V', quantity: null, value: 10000, assetType: 'equity', kind: 'etf' }] }, db);
  await commitSnapshot({ accountId: 'brk', asOf: '2026-07-31', source: 'manual', totalValue: 11000,
    holdings: [{ ticker: 'VTI', name: 'V', quantity: null, value: 11000, assetType: 'equity', kind: 'etf' }] }, db);
}

describe('get_portfolio_trend tool', () => {
  it('is a read-only tool', () => {
    expect(getPortfolioTrendTool.gate).toBe('none');
    expect(getPortfolioTrendTool.spec.name).toBe('get_portfolio_trend');
  });

  it('returns time-series value points', async () => {
    const { db } = makeTmpDb();
    await seed(db);
    const { content } = await getPortfolioTrendTool.run({ basis: 'monthly' }, { db });
    expect(content).toContain('11,000');
    // more than one period rendered
    expect(content.split('\n').length).toBeGreaterThan(1);
  });

  it('returns a no-data message on an empty db', async () => {
    const { db } = makeTmpDb();
    const { content } = await getPortfolioTrendTool.run({}, { db });
    expect(content).toContain('No investment');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/lib/agent/tools/__tests__/portfolioTrendTool.test.ts`
Expected: FAIL (`getPortfolioTrendTool` not exported).

- [ ] **Step 3: Add the tool to `read.ts`**

Extend the allocation import to include `nodeTrendSeries`:

```ts
import { buildAllocationWindowTree, earliestSnapshotDate, nodeTrendSeries, type AllocNode } from '@/lib/investments/allocation';
```

Add the tool:

```ts
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
```

Register `getPortfolioTrendTool,` in `readTools`. (Note: `Purpose` is already imported in read.ts.)

- [ ] **Step 4: Run test + add registry name**

Run: `cd app && npx vitest run src/lib/agent/tools/__tests__/portfolioTrendTool.test.ts`
Expected: PASS

Add `'get_portfolio_trend'` to `readTools.test.ts` expected names, then:
Run: `cd app && npx vitest run src/lib/agent/__tests__/readTools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/agent/tools/read.ts app/src/lib/agent/tools/__tests__/portfolioTrendTool.test.ts app/src/lib/agent/__tests__/readTools.test.ts
git commit -m "feat(agent): get_portfolio_trend tool"
```

---

### Task 6: `list_transactions` tool (windowed + paging)

**Files:**
- Modify: `app/src/lib/agent/tools/read.ts`
- Create: `app/src/lib/agent/tools/__tests__/listTransactionsTool.test.ts`
- Modify: `app/src/lib/agent/__tests__/readTools.test.ts`

**Interfaces:**
- Produces: `listTransactionsTool: Tool` (name `list_transactions`).
- Consumes: `readTransactions` (already imported in read.ts).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, transactions } from '@/db/schema';
import { listTransactionsTool } from '@/lib/agent/tools/read';

const NOW = '2026-08-03T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function seed(db: Db) {
  db.insert(accounts).values({
    id: 'chk', name: 'Checking', institution: 'Bank', accountClass: 'spending',
    type: 'depository', origin: 'manual', status: 'active', createdAt: NOW, modifiedAt: NOW,
  }).run();
  for (let i = 0; i < 5; i++) {
    db.insert(transactions).values({
      id: `t${i}`, accountId: 'chk', date: `2026-07-0${i + 1}`, description: `Store ${i}`,
      amount: -(i + 1), categoryId: 'food', subcategoryId: 'groceries', note: '',
      source: 'manual', createdAt: NOW, modifiedAt: NOW,
    }).run();
  }
}

describe('list_transactions tool', () => {
  it('is a read-only tool', () => {
    expect(listTransactionsTool.gate).toBe('none');
    expect(listTransactionsTool.spec.name).toBe('list_transactions');
  });

  it('pages results and reports how many more remain', async () => {
    const { db } = makeTmpDb();
    seed(db);
    const { content } = await listTransactionsTool.run({ limit: 2 }, { db });
    expect(content.split('\n').filter((l) => l.includes('id=')).length).toBe(2);
    expect(content).toContain('3 more');
    expect(content).toContain('offset=2');
  });

  it('filters by category', async () => {
    const { db } = makeTmpDb();
    seed(db);
    const { content } = await listTransactionsTool.run({ category: 'nonexistent' }, { db });
    expect(content).toContain('No matching transactions.');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/lib/agent/tools/__tests__/listTransactionsTool.test.ts`
Expected: FAIL (`listTransactionsTool` not exported).

- [ ] **Step 3: Add the tool to `read.ts`**

```ts
export const listTransactionsTool: Tool = {
  gate: 'none',
  spec: {
    name: 'list_transactions',
    description:
      'List spending/income transactions (the Home transactions table), newest first, with paging. ' +
      'Optionally filter by date range (from/to, YYYY-MM-DD) and category (case-insensitive substring of ' +
      'the category or subcategory id). Use limit (default 50, max 200) and offset to page.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Inclusive start date YYYY-MM-DD' },
        to: { type: 'string', description: 'Inclusive end date YYYY-MM-DD' },
        category: { type: 'string', description: 'Category/subcategory id substring' },
        limit: { type: 'number', description: 'Page size (default 50, max 200)' },
        offset: { type: 'number', description: 'Rows to skip (default 0)' },
      },
      additionalProperties: false,
    },
  },
  async run(input: { from?: string; to?: string; category?: string; limit?: number; offset?: number }, { db }) {
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200);
    const offset = Math.max(Math.trunc(input.offset ?? 0), 0);
    const cat = (input.category ?? '').toLowerCase();

    const all = (await readTransactions(db))
      .filter((t) => (input.from ? t.date >= input.from : true))
      .filter((t) => (input.to ? t.date <= input.to : true))
      .filter((t) => (cat ? t.categoryId.toLowerCase().includes(cat) || t.subcategoryId.toLowerCase().includes(cat) : true));

    const page = all.slice(offset, offset + limit)
      .map((t) => `${t.date} ${t.description} ${t.amount} [${t.categoryId}/${t.subcategoryId}] id=${t.id}`);
    if (page.length === 0) return { content: 'No matching transactions.' };

    const more = all.length - (offset + page.length);
    const footer = more > 0 ? `\n… ${more} more (use offset=${offset + limit}).` : '';
    return { content: `${page.join('\n')}${footer}` };
  },
};
```

Register `listTransactionsTool,` in `readTools`.

- [ ] **Step 4: Run test + add registry name**

Run: `cd app && npx vitest run src/lib/agent/tools/__tests__/listTransactionsTool.test.ts`
Expected: PASS

Add `'list_transactions'` to `readTools.test.ts` expected names, then run that test.
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/agent/tools/read.ts app/src/lib/agent/tools/__tests__/listTransactionsTool.test.ts app/src/lib/agent/__tests__/readTools.test.ts
git commit -m "feat(agent): list_transactions tool with windowing + paging"
```

---

### Task 7: Paging for `list_investment_transactions`

**Files:**
- Modify: `app/src/lib/agent/tools/read.ts` (`listInvestmentTransactionsTool`)
- Create: `app/src/lib/agent/tools/__tests__/listInvestmentTransactionsPaging.test.ts`

**Interfaces:**
- Consumes/Produces: same tool, now accepting `{ limit?, offset? }` and appending a "N more" footer.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { accounts, investmentTransactions } from '@/db/schema';
import { listInvestmentTransactionsTool } from '@/lib/agent/tools/read';

const NOW = '2026-08-03T00:00:00.000Z';
type Db = ReturnType<typeof makeTmpDb>['db'];

function seed(db: Db) {
  db.insert(accounts).values({
    id: 'brk', name: 'Brokerage', institution: 'Fidelity', accountClass: 'investment',
    type: 'investment', origin: 'manual', status: 'active', purpose: 'portfolio',
    createdAt: NOW, modifiedAt: NOW,
  }).run();
  for (let i = 0; i < 4; i++) {
    db.insert(investmentTransactions).values({
      id: `it${i}`, accountId: 'brk', plaidInvestmentTxnId: `p${i}`, securityId: null,
      date: `2026-07-0${i + 1}`, name: `Buy ${i}`, amount: 100 + i, type: 'buy', createdAt: NOW, modifiedAt: NOW,
    }).run();
  }
}

describe('list_investment_transactions paging', () => {
  it('limits the page and reports how many more remain', async () => {
    const { db } = makeTmpDb();
    seed(db);
    const { content } = await listInvestmentTransactionsTool.run({ limit: 2 }, { db });
    expect(content.split('\n').filter((l) => l.includes('Buy') || l.includes('buy')).length).toBe(2);
    expect(content).toContain('2 more');
    expect(content).toContain('offset=2');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npx vitest run src/lib/agent/tools/__tests__/listInvestmentTransactionsPaging.test.ts`
Expected: FAIL (no paging footer; limit ignored).

- [ ] **Step 3: Update `listInvestmentTransactionsTool` in `read.ts`**

Add `limit`/`offset` to the `inputSchema.properties`:

```ts
        limit: { type: 'number', description: 'Page size (default 50, max 200)' },
        offset: { type: 'number', description: 'Rows to skip (default 0)' },
```

Update the description to mention paging, and rewrite the `run` body to page instead of `.slice(0, 50)`:

```ts
  async run(input: { account?: string; from?: string; to?: string; type?: string; limit?: number; offset?: number }, { db }) {
    const ctx = await loadAllocationContext(db);
    if (ctx.exchanges.length === 0) return { content: NO_INVESTMENT_DATA };

    const acct = (input.account ?? '').toLowerCase();
    const typeFilter = (input.type ?? '').toLowerCase();
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200);
    const offset = Math.max(Math.trunc(input.offset ?? 0), 0);

    const filtered = ctx.exchanges
      .filter((t) => {
        if (!acct) return true;
        const label = (ctx.accountLabels.get(t.accountId) ?? '').toLowerCase();
        return t.accountId.toLowerCase() === acct || label.includes(acct);
      })
      .filter((t) => (input.from ? t.date >= input.from : true))
      .filter((t) => (input.to ? t.date <= input.to : true))
      .filter((t) => (typeFilter ? (t.type ?? '').toLowerCase() === typeFilter : true))
      .sort((a, b) => b.date.localeCompare(a.date));

    const rows = filtered.slice(offset, offset + limit).map((t) => {
      const label = ctx.accountLabels.get(t.accountId) ?? t.accountId;
      const name = t.name ? ` ${t.name}` : '';
      return `${t.date} ${label} ${t.type} ${money(t.amount)}${name}`;
    });
    if (rows.length === 0) return { content: 'No matching investment transactions.' };

    const more = filtered.length - (offset + rows.length);
    const footer = more > 0 ? `\n… ${more} more (use offset=${offset + limit}).` : '';
    return { content: `${rows.join('\n')}${footer}` };
  },
```

- [ ] **Step 4: Run the new test + the existing investment-tools test (no regression)**

Run: `cd app && npx vitest run src/lib/agent/tools/__tests__/listInvestmentTransactionsPaging.test.ts src/lib/agent/__tests__/investmentTools.test.ts`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/agent/tools/read.ts app/src/lib/agent/tools/__tests__/listInvestmentTransactionsPaging.test.ts
git commit -m "feat(agent): paging for list_investment_transactions"
```

---

### Task 8: Publish sections on the Investments page

**Files:**
- Modify: `app/src/app/components/investments/HoldingsBreakdown.tsx`
- Modify: `app/src/app/components/investments/PortfolioTrendChart.tsx`
- Modify: `app/src/app/components/investments/AllocationTree.tsx`

**Interfaces:**
- Consumes: `usePublishSection` (Task 2). Each component publishes one `ViewSection` from its own data state, gated to `null` while loading/error.

- [ ] **Step 1: HoldingsBreakdown — publish `investments.holdings`**

Add import: `import { usePublishSection } from '@/app/hooks/usePublishSection';`

After the `load` effect (`useEffect(() => { void load(); }, [load]);`, ~line 260) and before `return (`, add:

```tsx
  usePublishSection(
    entry
      ? {
          id: 'investments.holdings',
          order: 30,
          title: 'Holdings breakdown',
          summary: `${accounts.length} account(s); showing ${entry.accountName}: ${
            entry.endValue == null ? '—' : `$${entry.endValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
          }, ${entry.holdings.length} holding(s)`,
          detail: { tool: 'get_holdings_breakdown', args: { account: 'all', from, to } },
        }
      : null,
  );
```

- [ ] **Step 2: PortfolioTrendChart — publish `investments.trend`**

Add the same import. After the `chartData` useMemo (~line 194) and before `return (`, add:

```tsx
  usePublishSection(
    merged
      ? {
          id: 'investments.trend',
          order: 10,
          title: 'Portfolio trend',
          summary: `${merged.series.length} series (${merged.series.map((s) => s.label).join(', ')}); ${
            merged.labels[0] ?? ''}–${merged.labels[merged.labels.length - 1] ?? ''}; metric ${metric}`,
          detail: { tool: 'get_portfolio_trend', args: { basis, from, to, metric } },
        }
      : null,
  );
```

- [ ] **Step 3: AllocationTree — publish `investments.allocation`**

Add the same import. After `const tree = data?.tree ?? null;` (~line 206) and before `return (`, add:

```tsx
  usePublishSection(
    tree
      ? {
          id: 'investments.allocation',
          order: 20,
          title: 'Asset allocation',
          summary: `Total ${tree.balance == null ? '—' : `$${tree.balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}; ${
            tree.children
              .slice(0, 3)
              .map((c) => `${c.label} ${c.pctOfTotal == null ? '—' : `${(c.pctOfTotal * 100).toFixed(0)}%`}`)
              .join(', ')}`,
          detail: { tool: 'get_allocation_breakdown', args: { from, to } },
        }
      : null,
  );
```

- [ ] **Step 4: Typecheck + build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: PASS (no type errors; build succeeds).

- [ ] **Step 5: Commit**

```bash
git add app/src/app/components/investments/HoldingsBreakdown.tsx app/src/app/components/investments/PortfolioTrendChart.tsx app/src/app/components/investments/AllocationTree.tsx
git commit -m "feat(agent): publish Investments page sections to view context"
```

---

### Task 9: Publish sections on the Reserve page

**Files:**
- Modify: `app/src/app/investments/reserve/page.tsx`

**Interfaces:**
- Consumes: `usePublishSection`. Publishes two sections (trend + flows), gated on data.

- [ ] **Step 1: Add section publishing**

Add import: `import { usePublishSection } from '@/app/hooks/usePublishSection';`

After the existing `usePublishViewContext(error ? null : viewSnapshot);` (line 109), add (using `points`, `value`, and `dateRange` already in scope):

```tsx
  usePublishSection(
    !error && points.length > 0
      ? {
          id: 'reserve.trend',
          order: 10,
          title: 'Cash reserve trend',
          summary: `Balance ${value == null ? '—' : `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}; ${points.length} points`,
          detail: { tool: 'get_portfolio_trend', args: { purpose: 'reserve', from: dateRange.startDate, to: dateRange.endDate } },
        }
      : null,
  );
  usePublishSection(
    !error
      ? {
          id: 'reserve.flows',
          order: 20,
          title: 'Reserve flows',
          summary: 'Reserve contributions and withdrawals over the selected range',
          detail: { tool: 'query_reserve', args: { from: dateRange.startDate, to: dateRange.endDate } },
        }
      : null,
  );
```

- [ ] **Step 2: Typecheck + build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/src/app/investments/reserve/page.tsx
git commit -m "feat(agent): publish Reserve page sections to view context"
```

---

### Task 10: Publish sections on the Home page

**Files:**
- Modify: `app/src/app/page.tsx`

**Interfaces:**
- Consumes: `usePublishSection`. Publishes the transactions-table section (with `list_transactions` detail) and a summary-only spending-charts section. Both hook calls must sit above the `if (isLoading) return …` early return (~line 274).

- [ ] **Step 1: Add section publishing**

Add import: `import { usePublishSection } from '@/app/hooks/usePublishSection';`

Immediately after `usePublishViewContext(viewSnapshot);` (line 272), and before the `if (isLoading) return` (line 274), add (using `visibleTransactions`, `dateRange`, `tableFilters`, `categories` already in scope):

```tsx
  const txCategory = tableFilters.categoryId
    ? categories.find((c) => c.id === tableFilters.categoryId)?.name ?? tableFilters.categoryId
    : undefined;
  usePublishSection({
    id: 'home.transactions',
    order: 20,
    title: 'Transactions',
    summary: `${visibleTransactions.length} transaction(s) shown${txCategory ? ` in ${txCategory}` : ''}`,
    detail: {
      tool: 'list_transactions',
      args: {
        from: dateRange.startDate,
        to: dateRange.endDate,
        ...(tableFilters.categoryId ? { category: tableFilters.categoryId } : {}),
      },
    },
  });
  usePublishSection({
    id: 'home.spending-charts',
    order: 10,
    title: 'Spending charts',
    summary: 'Monthly expenses and category totals for spending accounts',
    detail: { tool: 'query_spending' },
  });
```

- [ ] **Step 2: Typecheck + build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/src/app/page.tsx
git commit -m "feat(agent): publish Home page sections to view context"
```

---

### Task 11: Chat route — verify sections reach `<current_view>`

**Files:**
- Modify: `app/src/app/api/agent/__tests__/chatRoute.test.ts`

**Interfaces:**
- Consumes: `formatViewContext` behavior (Task 1) as it flows through the route's `viewNote` assembly.

- [ ] **Step 1: Inspect the existing test to find the pattern**

Run: `cd app && sed -n '1,80p' src/app/api/agent/__tests__/chatRoute.test.ts` (read how it posts a request with `viewContext` and asserts on the captured system prompt / note). Reuse that harness.

- [ ] **Step 2: Add a test that a `sections` snapshot renders into the note**

Add a case that posts a body whose `viewContext` includes a `sections` array with a `detail` and asserts the captured system prompt contains the section title and the `[details: <tool>]` hint. Model it on the existing view-context assertion in this file. Concretely, the `viewContext` payload to include:

```ts
viewContext: {
  route: '/investments', label: 'Investments', highlights: [],
  sections: [{
    id: 'investments.holdings', title: 'Holdings breakdown', summary: '2 accounts',
    detail: { tool: 'get_holdings_breakdown', args: { account: 'all' } },
  }],
},
```

Assertion:

```ts
expect(capturedSystem).toContain('Sections on screen');
expect(capturedSystem).toContain('Holdings breakdown: 2 accounts [details: get_holdings_breakdown');
```

(Use the same variable the existing test uses to capture the system prompt passed to the provider/`runAgent`; match its mocking style.)

- [ ] **Step 3: Run the route test**

Run: `cd app && npx vitest run src/app/api/agent/__tests__/chatRoute.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app/src/app/api/agent/__tests__/chatRoute.test.ts
git commit -m "test(agent): sections flow into current_view note"
```

---

### Task 12: Full verification pass

- [ ] **Step 1: Run the whole unit suite**

Run: `cd app && npx vitest run`
Expected: PASS (no regressions). If a pre-existing unrelated failure appears, note it but do not fix in this plan.

- [ ] **Step 2: Typecheck + production build**

Run: `cd app && npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 3: Manual smoke (optional, if a dev server is available)**

Per `app/CLAUDE.md`: `cd app && npm run db:migrate` then `npm run dev`, open the assistant on `/investments`, and confirm it can answer "what's in my holdings breakdown / allocation / portfolio trend" by calling the new tools. Stop the server: `lsof -ti:3000 | xargs kill -9`.

- [ ] **Step 4: Commit any final touch-ups**

```bash
git add -A && git commit -m "chore(agent): final verification for page visibility" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- §1 data shapes (`ViewSection`, `sections?`) → Task 1. ✓
- §2 registry (base + section map, route reset, removal) → Task 1. ✓
- §3 hooks (`usePublishViewContext` retarget, `usePublishSection`) → Task 2. ✓
- §4 formatter (Sections block + detail hints, caps) → Task 1. ✓
- §5 tools: `get_holdings_breakdown` (Task 3), `get_allocation_breakdown` (Task 4), `get_portfolio_trend` (Task 5), `list_transactions` (Task 6), `list_investment_transactions` paging (Task 7). ✓
- §6 rollout: Investments (Task 8), Reserve (Task 9), Home (Task 10). ✓
- Testing: store/formatter (Task 1), each tool (Tasks 3–7), chat route (Task 11), full pass (Task 12). ✓

**Placeholder scan:** No TBD/TODO. The only "read then mirror" step is Task 11 Step 1, which inspects the existing route test harness — unavoidable because the test's provider-mock capture variable is local to that file; the exact payload and assertions are given.

**Type consistency:** Tool names are consistent between tool specs, `readTools.test.ts` expectations, and the section `detail.tool` values in Tasks 8–10 (`get_holdings_breakdown`, `get_allocation_breakdown`, `get_portfolio_trend`, `list_transactions`, `query_reserve`, `query_spending`). `ViewSection`/`ViewBase`/`getViewContext` signatures match across Tasks 1–2. `loadAccountBreakdown` signature matches its route + tool callers (Task 3). `fmtReturn` is defined once in Task 3 and reused in Task 4.

**Note for the executor:** Tasks 3–7 each add to the `readTools` array and the `readTools.test.ts` expected-names list; if executed out of order, keep both in sync. `fmtReturn` (Task 3) must exist before Task 4 uses it — keep Task order.
