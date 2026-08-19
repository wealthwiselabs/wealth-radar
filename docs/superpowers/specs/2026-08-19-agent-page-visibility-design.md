# AI Advisor — Full Page Visibility Design

**Date:** 2026-08-19
**Status:** Approved design, pending implementation plan
**Branch:** `claude/ai-advisor-page-visibility-4a519f`

## Problem

The AI advisor only sees page-level **highlights** (e.g. Portfolio total, Education,
Insurance figures). It cannot see the detailed content actually rendered on screen — the
holdings/transactions breakdown table, the portfolio trend line-chart data points, etc. So
it answers "I can only see the highlights, not this breakdown," which is exactly the gap
the user hit.

Two forces shape the fix:

1. **Visibility for all sections.** The agent should always know *what sections are on the
   current page* and a one-line gist of each — for every page (Home, Investments, Reserve),
   scoped to wherever the user currently is.
2. **Detail on demand, not in bulk.** Rather than dumping full tables and every chart point
   into context on every message (token-heavy, and stale the moment the user loads more
   data), the agent pulls the full/live data for a section through **tools** when it needs
   it. This also covers "the user loaded more transactions" — a tool hits live data.

## Current architecture (as-is)

Producer → consumer flow:

```
Page component
  builds ViewSnapshot ──▶ usePublishViewContext(snapshot)
                              │ setViewContext() into module singleton
                              ▼
                    app/src/app/lib/viewContext.ts  (single `current` snapshot)
                              │ getViewContext()
                              ▼
  useAgentChat.send() ──▶ POST /api/agent/chat  body.viewContext
                              │ (server)
                              ▼
  route.ts: formatViewContext() ──▶ withContextNote() wraps in <current_view>…</current_view>
                              ──▶ buildSystemPrompt() ──▶ runAgent()
```

Key facts:

- `ViewSnapshot` (`app/src/app/lib/viewContext.ts:1-8`) has `route`, `label`, `timeRange?`,
  `filters?`, `highlights[]`, and an unused `tables?` field.
- The store holds **one** `current` snapshot, published by **one** page component. On the
  Investments page the detailed data lives inside **self-fetching child components**
  (`PortfolioTrendChart`'s `merged` state, `HoldingsBreakdown`'s `entry` state) that never
  surface it to the page building the snapshot.
- `formatViewContext` (`viewContext.ts:34-70`) renders route/label/timeRange/filters/
  highlights (and would render `tables`, but nothing populates it).
- Agent tools follow the `Tool` contract (`app/src/lib/agent/tools/types.ts`): read tools
  use `gate:'none'`, run inline, and return a `{ content: string }` result. Six read tools
  exist today (`app/src/lib/agent/tools/read.ts`): `search_transactions`, `query_spending`,
  `investment_summary`, `list_investment_transactions`, `query_investment_returns`,
  `query_reserve`. They call `@/lib/*` helpers directly, **not** the HTTP routes.
- The **knowledge-topic** pattern (`tools/knowledge.ts` + `systemPrompt.ts:20`) is the
  existing precedent for "list available things up front, pull one on demand." This design
  mirrors it for on-screen sections.
- Max agent loop iterations: 8 (`loop.ts:31`).

## Approach (chosen: "Section registry + on-demand tools")

Two layers:

- **Passive summaries** — every on-screen section contributes a short summary to the view
  context. The agent always sees the full list of sections + gists in `<current_view>`.
- **On-demand pull** — each section names a tool (+ suggested args) that returns its full,
  live data. Reuse existing read tools; add a few to fill genuine gaps.

Rejected alternatives: **fat context** (dump all data every message — token-heavy, can't
reflect data loaded after the snapshot); **pure tools** (no section summaries — loses
passive visibility the user explicitly asked for).

## Design

### 1. Client data shapes (`app/src/app/lib/viewContext.ts`)

`highlights` stays as the page-level KPI strip. Add `sections[]` for the discrete on-screen
blocks. Remove the unused `tables?` field (superseded by `sections`).

```ts
export interface ViewSection {
  id: string;            // stable per section, e.g. 'investments.holdings'
  order?: number;        // position on page; for deterministic rendering
  title: string;         // 'Holdings breakdown'
  summary: string;       // one-line gist: '3 accounts, $412k; top VOO $120k (29%)'
  detail?: {             // how the agent pulls full/live data
    tool: string;        // e.g. 'get_holdings_breakdown'
    args?: Record<string, unknown>;  // reflects current filters, e.g. { account: 'all', from, to }
  };
}

export interface ViewSnapshot {
  route: string;
  label: string;
  timeRange?: string;
  filters?: Record<string, string>;
  highlights: { label: string; value: string }[];
  sections?: ViewSection[];
}
```

### 2. The registry — distributed contribution (`app/src/app/lib/viewContext.ts`)

Replace the single `current` snapshot with a **base + section map** that `getViewContext`
composes, so self-fetching child components can contribute without lifting their data:

```ts
type BaseSnapshot = Omit<ViewSnapshot, 'sections'>;

let base: BaseSnapshot | null = null;
const sections = new Map<string, ViewSection>();
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

// Publishing the base (page-level). A route change resets sections so stale
// sections from the previous page cannot leak.
export function setViewBase(b: BaseSnapshot | null): void {
  if (b === null) { base = null; sections.clear(); notify(); return; }
  if (!base || base.route !== b.route) sections.clear();  // navigation reset
  base = b;
  notify();
}

// Publishing / removing a single section (component-level).
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
  return () => { listeners.delete(fn); };
}
```

Notes:
- `setViewContext` (the old single-snapshot setter) is removed; callers migrate to
  `setViewBase`. `subscribe`/`getViewContext` keep their signatures, so `useAgentChat` and
  `useViewContext` consumers are unaffected.
- Section removal on unmount plus the route-change reset both guard against stale sections.

### 3. Hooks

- `usePublishViewContext` (`app/src/app/hooks/usePublishViewContext.ts`) — retarget to
  `setViewBase`; clear the base on unmount (`setViewBase(null)`). Value-compare via
  `JSON.stringify` as today.
- **New** `usePublishSection` (`app/src/app/hooks/usePublishSection.ts`):

```ts
'use client';
import { useEffect } from 'react';
import { setViewSection, removeViewSection, type ViewSection } from '@/app/lib/viewContext';

/** Register this section's summary into the shared view context; remove on unmount.
 *  Pass null while the section has no data yet (loading/error) to omit it. */
export function usePublishSection(section: ViewSection | null): void {
  useEffect(() => {
    if (!section) return;
    setViewSection(section);
    return () => removeViewSection(section.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compare by value, not identity.
  }, [JSON.stringify(section)]);
}
```

### 4. Server formatter (`app/src/app/lib/viewContext.ts`)

Replace the `tables` rendering with a **Sections** block. Each line carries the pull hint so
the agent knows exactly which tool + args to call:

```
Sections on screen (call the referenced tool to load full or updated data):
- Holdings breakdown: 3 accounts, $412k total; top VOO $120k (29%). [details: get_holdings_breakdown {"account":"all"}]
- Portfolio trend: 3 series (Portfolio/Education/Insurance), Jan–Aug 2026; latest Portfolio $412k. [details: get_portfolio_trend {"path":"portfolio","metric":"value"}]
- Returns by purpose: portfolio +6.1%, education +4.0%, reserve +1.2% (YTD). [details: query_investment_returns]
```

Rules:
- Cap at `MAX_SECTIONS = 12`; truncate any single summary to `MAX_SUMMARY_LEN` (~160 chars).
- A section with no `detail` renders without the `[details: …]` suffix (summary-only).
- Args serialized as compact JSON. Omit the `{…}` when there are no args.

### 5. New / upgraded tools (`app/src/lib/agent/tools/read.ts`)

All `gate:'none'`, returning `{ content: string }`, calling `@/lib/*` helpers directly.

**New: `get_holdings_breakdown`** — per-account holdings breakdown + recent transactions
(the Investments breakdown table). A new `loadAccountBreakdown(scope, from, to, db)` helper
in `@/lib/investments/read` assembles the inputs (accounts, overrides, snapshots, flows,
securities, transactions) and calls `assembleBreakdown`; the existing
`/api/investments/breakdown` route is refactored to call the same helper (DRY), and the tool
calls it too — keeping raw `db.select` out of the tool layer.
- Input: `{ account?: string ('all' or id), from?: string, to?: string }`.
- Output: per account — name/purpose, start/end value, ROI, top holdings (ticker, value,
  %, ROI), and recent transactions.

**New: `get_portfolio_trend`** — allocation / purpose trend data points (the line charts).
Wraps the trend helpers behind `/api/investments/allocation/trend` and
`/api/investments/purpose-trend`.
- Input: `{ path?: string, purpose?: string, basis?: 'monthly'|'quarterly'|'yearly',
  from?: string, to?: string, metric?: 'value'|'roi' }`.
- Output: the time series (period label, value, roi) for the requested node/purpose.

**New: `get_allocation_breakdown`** — the full nested asset-allocation tree (the
`AllocationTree` block). Wraps `buildAllocationWindowTree(ctx, from, to)`
(`@/lib/investments/allocation`), the same helper behind
`/api/investments/allocation/range` — window-based, matching what the component renders.
- Input: `{ from?: string, to?: string }` (from defaults to the earliest snapshot, to to today).
- Output: the nested buckets — label, depth, balance, % of total, value change, ROI —
  rendered as an indented tree.

**New: `list_transactions`** — windowed spending-transaction listing with real paging (the
Home transactions table; the underlying `/api/transactions` route has no paging).
- Input: `{ from?: string, to?: string, category?: string, limit?: number, offset?: number }`.
- Output: rows newest-first for the page, plus a total-count / "N more" indicator so the
  agent can page.

**Upgrade: `list_investment_transactions`** — add `{ limit?: number, offset?: number }`
paging (default limit 50, as today) so long account histories aren't silently truncated.
Emit a "N more" indicator when the window is capped.

Register the four new tools in the `readTools` array (`read.ts:263-270`); `allTools` /
`byName` in `chat/route.ts` pick them up automatically.

### 6. Per-page rollout

**Investments** (`app/src/app/investments/page.tsx` + children):
- Base (unchanged): route/label, `filters:{basis,metric}`, highlights (Portfolio/
  Education/Insurance).
- `HoldingsBreakdown.tsx` → section `investments.holdings`, summary from `entry` state,
  `detail: { tool: 'get_holdings_breakdown', args: { account, from, to } }`.
- `PortfolioTrendChart.tsx` → section `investments.trend`, summary from `chartData`,
  `detail: { tool: 'get_portfolio_trend', args: { path, basis, from, to, metric } }`.
- `AllocationTree.tsx` → section `investments.allocation`, summary from its tree,
  `detail: { tool: 'get_allocation_breakdown', args: { from, to } }`.
- Remaining blocks (ReturnsGrid, AccountTable, PurposeTiles) publish **summary-only**
  sections, referencing existing tools where natural (`investment_summary`,
  `query_investment_returns`). No new tools for these initially (YAGNI).

**Reserve** (`app/src/app/investments/reserve/page.tsx`):
- Base (unchanged): reserve balance highlight.
- Trend + flows section → `detail: query_reserve` (and/or `get_portfolio_trend` with
  `purpose:'reserve'`).

**Home** (`app/src/app/page.tsx`):
- Base (unchanged): Total Expenses / Income / Net highlights.
- Transactions table section → `detail: { tool: 'list_transactions', args: { from, to,
  category } }` reflecting the active filters.
- Spending charts (CategoryTotals, MonthlyExpenses) → summary-only, referencing
  `query_spending`.

## Testing

- **`app/src/app/lib/__tests__/viewContext.test.ts`** (extend): registry merge (base +
  sections), deterministic ordering by `order`/`id`, route-change reset, section removal,
  and `formatViewContext` rendering of the Sections block + detail hints (with/without
  args, summary-only, caps).
- **`app/src/lib/agent/tools/__tests__/`** (new/extend): `run()` for `get_holdings_breakdown`,
  `get_portfolio_trend`, `get_allocation_breakdown`, `list_transactions`, and the
  `list_investment_transactions` paging upgrade — each against a seeded `makeTmpDb()`,
  driving real code paths.
- **`app/src/app/api/agent/__tests__/chatRoute.test.ts`** (extend): a snapshot with
  `sections` reaches the `<current_view>` note.
- Hooks are thin; covered indirectly via the store tests.

## Out of scope (YAGNI)

- Dedicated detail tools for the remaining Investments sub-sections (per-grid returns,
  account table, purpose tiles) — summary-only for now; add later if the agent proves it
  needs them.
- Server-side pagination on the underlying `/api/transactions` route — paging is done at the
  tool layer.
- Streaming section updates mid-message — the snapshot is captured at send time, as today.

## Risks / notes

- **Token budget:** summaries are one line each, capped and count-limited, so `<current_view>`
  stays small. Full data only enters context when the agent calls a tool.
- **Staleness:** summaries reflect snapshot-at-send-time; the tools hit live data, so a
  "load more" divergence is resolved by the agent pulling via tool.
- **Migration:** removing `setViewContext`/`tables` touches the three current publishers and
  the store test; all are in-repo and updated in the same change.
