# AI Financial Advisor — Design Spec

**Status:** Draft for review
**Date:** 2026-08-16
**Scope of this spec:** The agent runtime, LLM-agnostic provider layer, floating chat widget, read-only tools, **and** the write/mutation tools (edit transaction metadata, update matching rules, reconcile, merge accounts). Budgets & alerts are **deferred to a separate spec** — tool boundaries here are designed so that feature slots in later without rework.

---

## 1. Goal

Add an AI financial-advisor feature to Wealthwise: a floating sidebar chat, backed by an agent that can answer personal-finance and expense questions, reason about the user's portfolio, and — with appropriate confirmation — mutate their data (transaction metadata, matching rules, reconciliation, account merges). The LLM backend must be swappable (Anthropic today; OpenAI or local models later) with no change to call sites.

Non-goals (this spec): budgets, category alerts, a supervisor/multi-agent hierarchy, and personalized *licensed* financial advice.

---

## 2. Key decisions (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Runtime | Thin hand-rolled `LLMProvider` interface | Matches the repo's lean, hand-rolled style; avoids inheriting a framework's churn/abstraction (evaluated LangChain/LangGraph, Vercel AI SDK, Mastra, LlamaIndex — all heavier or noisier for one sidebar widget). |
| Anthropic adapter | Native `@anthropic-ai/sdk` | Keeps Claude Sonnet 5's real request shape, adaptive thinking, and prompt caching over the large taxonomy/knowledge context. |
| OpenAI / local adapter | OpenAI SDK pointed at configurable `baseURL`/`model`/`apiKey` | One adapter covers OpenAI **and** every OpenAI-compatible local runtime (Ollama, vLLM, LM Studio). Anthropic's OpenAI-compat endpoint is deliberately *not* used for Claude — it drops thinking/caching. |
| Topology | Single tool-calling loop + knowledge-as-skills + one-shot sub-task spawn | The three envisioned "subagents" differ by *tools and knowledge*, not reasoning — a single well-prompted loop routes implicitly at ~10 tools. Supervisor routing adds latency/tokens/debugging cost with no parallelism to justify it. Heavy bounded jobs spawn a sub-task instead of a standing hierarchy. |
| Advisor "subagent" | Knowledge layer, not an agent | Portfolio-planning know-how is reference material → progressive-disclosure markdown loaded on demand. |
| Confirmation | Tiered (see §6) | Reversibility-based: reads free, single-row edits apply-with-undo, rule/reconcile/merge gated. |
| Interactive UI | First-class agent protocol | The agent attaches UI affordances (confirm cards, select chips, pickers); clicks return structured responses so the user rarely types. |
| Persistence | New SQLite tables | Local-first; conversations survive reload. |

---

## 3. Architecture overview

```
┌────────────────────────── Browser ──────────────────────────┐
│  Floating button ──▶ Chat panel (React)                      │
│    useAgentChat hook: SSE stream, message list, UI affordances│
└───────────────┬──────────────────────────────────────────────┘
                │  POST /api/agent/chat  (SSE)   ▲ structured user actions
                ▼                                │
┌──────────────────────── Next.js server ─────────────────────┐
│  Agent loop (src/lib/agent/loop.ts)                          │
│    ├─ LLMProvider (streamChat)                               │
│    │     ├─ AnthropicProvider  (@anthropic-ai/sdk)           │
│    │     └─ OpenAIProvider      (openai SDK, baseURL/model)  │
│    ├─ Tool registry                                          │
│    │     read:  search_transactions, query_spending,        │
│    │            query_investments, web_search, web_fetch     │
│    │     write: edit_transaction_metadata, update_matching_  │
│    │            rule, reconcile_transactions, merge_accounts │
│    │     meta:  load_knowledge, spawn_task                   │
│    └─ Confirmation gate + UI-affordance emitter              │
│                                                              │
│  Tools call EXISTING domain fns (never raw SQL):             │
│    aggregates.ts, categoryRules.ts, ruleBackfill.ts,         │
│    accountMerge.ts, investments/*, spending.ts, backup.ts    │
│                                                              │
│  Persistence: conversations, agent_messages (Drizzle)        │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. LLM-agnostic provider layer

### 4.1 Interface (`src/lib/agent/providers/types.ts`)

```ts
export interface LLMProvider {
  streamChat(req: LLMRequest): AsyncIterable<LLMEvent>;
}

export interface LLMRequest {
  system: string;
  messages: AgentMessage[];          // normalized, provider-neutral
  tools: ToolSpec[];                 // normalized tool schemas
  model: string;                     // from config
  signal?: AbortSignal;
}

export type LLMEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }         // Anthropic only; OpenAI adapter no-ops
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'done'; stopReason: 'end' | 'tool_use' | 'length' | 'refusal' };
```

- **`AnthropicProvider`** — maps to `messages.create({ stream: true })`, `thinking: { type: 'adaptive' }`, prompt-caches the system prompt + tool list + knowledge manifest. Default model `claude-sonnet-5` (config-overridable). Handles `stop_reason: 'refusal'`.
- **`OpenAIProvider`** — maps to OpenAI chat completions with `tools`, streaming deltas → normalized events. Config `{ baseURL, model, apiKey }`. Translates the shared `ToolSpec` JSON-schema to each wire format.

### 4.2 Config & keys

`AgentConfig = { provider: 'anthropic' | 'openai'; model: string; baseURL?: string }` in `data/preferences.json` (or a new `agent` section), plus a Settings UI control. Keys follow the existing pattern: per-request header from localStorage (Settings) with env fallback. Reuse/extend `src/lib/apiKey.ts` (generalize the `x-anthropic-api-key` header to a provider-scoped key header).

---

## 5. Agent loop & tools

### 5.1 Loop (`src/lib/agent/loop.ts`)

Standard tool-use loop: call `streamChat` → forward text/thinking deltas to the client over SSE → on `tool_call`, execute the tool (or, if gated, emit a proposal + confirm affordance and **pause**) → append the tool result → repeat until `stopReason === 'end'`. `max_iterations` cap. The loop is provider-agnostic (only touches `LLMProvider` + the tool registry).

### 5.2 Tool registry (`src/lib/agent/tools/`)

Every tool is `{ spec: ToolSpec; gate: 'none' | 'apply-undo' | 'confirm'; run(input, ctx): ToolResult }`. **All writes call existing domain functions** so the repo's invariants hold (snapshot before mutation via `backup.ts`; `recomputeMonthlyAggregates` after; respect `superseded_by`; account-identity rules).

| Tool | Wraps | Gate |
|---|---|---|
| `search_transactions` | `readTransactions` / `spending.ts` | none |
| `query_spending` | `aggregates.ts` | none |
| `query_investments` | `investments/{allocation,returns,breakdown}.ts` | none |
| `web_search` | provider server-tool or a fetch-based search | none |
| `web_fetch` | server-side fetch (allowlist, size cap) | none |
| `edit_transaction_metadata` | transactions update + `recomputeMonthlyAggregates` | apply-undo |
| `update_matching_rule` | `categoryRules.ts` + `ruleBackfill.ts` | confirm |
| `reconcile_transactions` | dedupe/reconcile in `ingest.ts`/`aggregates.ts` | confirm |
| `merge_accounts` | `accountMerge.ts` | confirm (hard) |
| `load_knowledge` | reads a knowledge doc by topic | none |
| `spawn_task` | runs a bounded one-shot sub-loop, returns summary | none |

### 5.3 Spawn escape-hatch (topology "C")

`spawn_task(goal, allowedTools)` runs a fresh, bounded agent loop (own context window, restricted tool set, iteration cap) for heavy jobs — "reconcile every account", "scan the whole portfolio and draft a rebalance". It returns a **summary** to the parent loop, not its full trace. Not a standing subagent; created per task.

---

## 6. Confirmation tiering

| Action | Gate | Behavior |
|---|---|---|
| All reads (search, query, web) | none | Execute immediately. |
| Single-row metadata edit | apply-undo | Apply, render what changed, offer Undo. |
| Update matching rule (+ backfill) | confirm | Show affected-count diff; execute on approve. |
| Reconcile transactions | confirm | Show the reconcile diff; execute on approve. |
| Merge bank accounts | confirm (hard) | Show both accounts + merge preview; execute on approve. |

**Mechanism:** a gated tool does **not** mutate. It returns a *proposal* payload; the loop emits a `confirm` UI affordance carrying the concrete diff; the widget renders a confirm/deny card; on approve, the widget posts a structured action back, and the loop calls the real mutation (domain fn → snapshot → recompute).

---

## 7. Interactive UI protocol

Agent output can carry **affordances** the widget renders as controls, so the user selects/confirms instead of typing.

```ts
type UIAffordance =
  | { kind: 'confirm'; token: string; title: string; diff: DiffView; confirmLabel: string }
  | { kind: 'select'; token: string; prompt: string; options: Option[] }        // single
  | { kind: 'multiselect'; token: string; prompt: string; options: Option[] }
  | { kind: 'account_picker'; token: string; prompt: string; accounts: AccountRef[] }
  | { kind: 'suggestions'; options: Option[] };                                  // quick replies
```

- Emitted over the SSE stream as a distinct event type.
- A click posts `{ token, value }` to `/api/agent/chat` as a **structured user action**, resumed into the loop exactly like a tool result / user turn.
- Confirm cards are the highest-stakes affordance; the same channel powers disambiguation ("which of these 3 accounts?"), quick replies, and multi-select category fixes.

---

## 8. Transport & persistence

- **Route:** `POST /api/agent/chat` streams SSE (`text`, `thinking`, `tool_call`, `ui`, `done` events). Structured user actions POST to the same route with `{ conversationId, action }`.
- **Tables (Drizzle, `src/db/schema.ts`):**
  - `agent_conversations` — `id`, `title`, `createdAt`, `modifiedAt`.
  - `agent_messages` — `id`, `conversationId`, `role` (`user|assistant|tool`), `content` (JSON: text + tool calls + affordances), `createdAt`.
- Migration via `npm run db:generate` + `db:migrate`. Snapshot invariants unaffected (agent writes go through existing domain fns which already snapshot).

---

## 9. Widget (frontend)

- `AgentWidget.tsx` — floating button (bottom corner) → expandable chat panel. Mounted globally in the app shell (alongside `AppHeader`/`ThemeSync` in `src/app`).
- `useAgentChat` hook — opens the SSE stream, accumulates streamed text, renders message list + affordances, posts structured actions. Reuses `dataEvents.ts` (`notifyDataChanged`) after any mutation so the main tables/charts refresh.
- Renders thinking (collapsed), tool activity (compact), and affordance controls.

---

## 10. Safety

- **Untrusted content boundary:** output of `web_fetch`/`web_search` and raw transaction descriptions are data, never instructions. The system prompt states this; nothing they contain can trigger a mutation without its confirmation tier being satisfied.
- **No silent mutation:** gated tools cannot mutate; only an approved confirm token executes the real write.
- **Domain-fn-only writes:** tools never issue raw SQL, preserving snapshot/aggregate/superseded/account-identity invariants.
- **Advisor framing:** knowledge is presented as general educational information; the agent does not present itself as a licensed advisor, and the system prompt says so.
- **Web allowlist + size caps** on `web_fetch`.

---

## 11. Knowledge base (advisor expertise)

Progressive-disclosure markdown under `src/lib/agent/knowledge/` with a manifest (`{ topic, description }`). The agent calls `load_knowledge(topic)` to pull the full doc only when relevant (keeps context lean, cache-friendly).

**Implementation task — knowledge-base interview:** during the build, the author is interviewed to produce the initial docs. Interview covers: financial goals & horizon, risk tolerance, target asset allocation, rebalancing rules/thresholds, account roles (portfolio/reserve/insurance — mirrors `accounts.purpose`), tax-lot/withdrawal preferences, and the author's own planning heuristics. Output: one doc per topic (`portfolio-allocation.md`, `rebalancing.md`, `account-roles.md`, …) plus the manifest.

---

## 12. Build sequence (→ implementation plan)

1. `LLMProvider` interface + `AnthropicProvider` (native SDK, Sonnet 5, streaming, thinking, caching).
2. Agent loop + read tools + `/api/agent/chat` SSE + minimal widget — prove end-to-end.
3. Persistence (conversations/messages tables + migration).
4. Interactive UI protocol + confirm-card rendering.
5. Write tools behind the confirmation tiers (wrapping domain fns; snapshot/recompute).
6. Knowledge layer + `load_knowledge` + **advisor knowledge-base interview**.
7. Spawn escape-hatch (`spawn_task`).
8. `OpenAIProvider` (OpenAI + local via `baseURL`); Settings control for provider/model.

---

## 13. Testing

TDD per repo convention: failing test → implement. Unit tests in `src/lib/agent/__tests__/` using `makeTmpDb()`, driving real domain code paths (never mocks) for tool mutations — assert snapshots taken and aggregates recomputed. Provider adapters tested against recorded event fixtures. A thin end-to-end test drives the loop with a stub `LLMProvider` that emits scripted tool calls, verifying gating (proposal vs. mutation) and the confirm→execute round-trip.

---

## 14. Deferred / open

- **Budgets & alerts** — separate spec; `query_spending`/tool boundaries designed to accommodate it.
- Web-search implementation choice (provider server-tool vs. dedicated search) — decide at step 2.
- Multi-conversation history UI (list/rename/delete) — minimal in v1, expandable.
- Rebalance *execution* is out of scope (advice only; no trades — trades are a prohibited action).
