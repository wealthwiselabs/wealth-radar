# Chat Panel Redesign + Markdown + Local-Test Setup — Design Spec

**Status:** Draft for execution in a new session
**Date:** 2026-08-17
**Branch:** `claude/financial-advisor-agent-44b9f5` (continue on it; do not start from main)

## Context (read first)

This continues an **already-built, already-reviewed** AI financial-advisor feature. The agent, tools, confirmation flow, knowledge base, and memory are all done and green (744 tests). This spec covers three **follow-up** workstreams on the existing chat UI + local dev experience. It is self-contained — assume no prior conversation.

**What already exists (files you will touch or reuse):**
- `src/app/components/agent/AgentWidget.tsx` — floating launcher button + expandable panel (current: a small floating card bottom-right).
- `src/app/components/agent/ChatPanel.tsx` — the chat UI (message list + input + send). Renders message text with `whitespace-pre-wrap` (plain text today).
- `src/app/components/agent/Affordances.tsx` — renders interactive affordances (confirm cards, select/suggestions). **Keep working after the redesign.**
- `src/app/components/agent/AssistantIcon.tsx` — **already created** sparkle "AI" icon (inline SVG, `currentColor`). Use it in the header.
- `src/app/hooks/useAgentChat.ts` — the SSE hook. Exposes `{ messages, affordances, streaming, send, respond }`. `messages` is `{ role: 'user'|'assistant', text }[]`. It tracks `convId` in a `useRef`, parses SSE frames (`conversation`, `text`, `proposal`/affordance, `error`, `done`), surfaces `⚠️ <message>` on errors, and calls `notifyDataChanged()` after an approved write. Preserve all of this.
- `src/app/api/agent/chat/route.ts` — the streaming route. No change needed for this spec unless a workstream says so.
- The main app shell: `src/app/layout.tsx` mounts `<AgentWidget/>` in `<body>` after `{children}`. `AppHeader.tsx`, `SettingsButton.tsx`, and `src/app/globals.css` establish the house style (Tailwind 4; look for existing utility classes like `origin-input`, `origin-select`, the card/border/`<hr>` patterns, and the `--font-inter`/`--font-display` fonts). Theme is light/dark via `data-theme` on `<html>`; use the same dark-mode conventions (`dark:` variants) the rest of the app uses.
- PDF import pipeline (for the attach button): `src/app/components/PDFUploadZone.tsx` (full drop-zone; prop `onTransactionsClassified(PendingTransaction[])`), `src/app/components/ImportPanel.tsx` (owns the classify→preview→commit flow via `handleTransactionsClassified`), `src/lib/pdfExtractor.ts` (`extractTextFromPDF`, `isPDF`), `src/lib/pdfBatch.ts` (`pdfsFromFileList`), `POST /api/classify`. Reuse these — do not reinvent PDF parsing/classification.

**Global constraints:** Next.js 15 App Router, React 19, TypeScript, Tailwind 4. TDD where there's real logic (`npm test`, vitest; `npx tsc --noEmit` must stay clean). Match existing house style; theme-aware (light/dark). Keep the agent's streaming, error-surfacing (`⚠️`), interactive affordances, and `notifyDataChanged()`-on-write behavior intact. Commit per task.

---

## Decisions (already made with the owner — do not re-litigate)

1. **Docking:** the panel is a **right-side, full-viewport-height overlay** that floats over the page (page layout does NOT reflow). A launcher button opens it; a minimize button collapses it back to the launcher.
2. **Header controls:** assistant **sparkle icon + name "Wealthwise Advisor"**, a **new-chat (refresh)** button, and a **minimize/close** button. (No online-status line.)
3. **Input:** text input + send, plus an **attachments button** that imports a bank-statement PDF via the existing pipeline. (No emoji picker.)
4. **Name:** **"Wealthwise Advisor"**.
5. **Markdown:** assistant messages render **markdown** (see Workstream C).

---

## Workstream A — Local test setup (documentation, no secret copying)

**Goal:** make it easy (and safe) to run the app locally to test the agent.

- **Do NOT copy `.env.local` (or any secrets) from a personal repo into this OSS repo.** It holds `ANTHROPIC_API_KEY`, `APP_ENCRYPTION_KEY`, Plaid secrets — personal infra that must stay out of the public repo. `.env.local` is gitignored, but secret-handling is the owner's to do, not an agent's.
- **What's actually needed to test the agent:** nothing in env. The Anthropic API key is entered in **Settings** (stored in browser localStorage, sent as the `x-agent-api-key` header). Auth gate is off in dev (no `AUTH_PASSWORD`).
- **Deliverable:** add a short "Running locally to test the assistant" section to `app/CLAUDE.md` (or a `docs/` note) documenting:
  1. `cd app && npm run db:migrate` — one-time, creates `data/app.db` (gitignored) with all tables (including `agent_conversations`, `agent_messages`, `agent_memory`).
  2. `cd app && npm run dev` → http://localhost:3000.
  3. Settings → paste your Anthropic API key (and optionally provider/model — defaults to `claude-sonnet-5` at high effort).
  4. Optional: to also test Plaid/import beyond PDFs, create your own local `app/.env.local` from `app/.env.example` (never commit it).
  5. Stop: `lsof -ti:3000 | xargs kill -9`.
- No code change beyond docs. This is a small task; fold it into the first commit.

---

## Workstream B — Right-docked, cohesive chat panel

Redesign `AgentWidget.tsx` + `ChatPanel.tsx` (and add small subcomponents as needed) into a polished, right-docked panel consistent with the app. Reference: the owner's chatbot-UI mockup (header with icon/name/refresh/close, date divider, message bubbles, quick replies + suggested replies, input with attach + send).

### Layout & behavior
- **Launcher:** keep a floating launcher button bottom-right (reuse/restyle the current one; use `AssistantIcon`). Clicking opens the panel; hide the launcher (or animate it) while open.
- **Panel:** `position: fixed; top:0; right:0; height:100vh; width: ~380–420px` (pick a width that reads well; responsive: on narrow viewports it may go full-width). It **overlays** the page — do not change the main layout container. Add a subtle left border/shadow so it reads as a panel. Smooth open/close (slide-in from right is nice-to-have, not required).
- **Minimize** collapses back to the launcher (same state the current open/close toggle uses).
- **New chat (refresh):** resets the conversation — clear the hook's `convId` ref and `messages`/`affordances`. Add a `reset()` to `useAgentChat` that clears local state and the conversation id (a fresh id is created server-side on the next message). Confirm-before-clear is optional; a single click reset is fine.
- **Accessibility:** the panel is a dialog-like region — `role="dialog"`, `aria-label="Wealthwise Advisor"`, focus the input on open, Escape minimizes, buttons have `aria-label`s. Keep tab targets ≥ the app's norm.

### Header
- Left: `AssistantIcon` (in a small rounded tile/avatar using an accent color consistent with the app) + **"Wealthwise Advisor"** in the display font.
- Right: **new-chat** (refresh icon) and **minimize/close** (chevron/X) icon buttons, styled like other icon buttons in the app.

### Message area
- Scrollable, fills the space between header and input. Auto-scroll to the newest message on new content (and while streaming).
- **Bubbles:** assistant messages left-aligned, user messages right-aligned, using app-consistent surfaces (assistant: subtle neutral surface; user: accent). Comfortable spacing/typography matching the app. Assistant text renders **markdown** (Workstream C).
- Render `<Affordances/>` inline in the flow (confirm cards, select/suggestion chips) exactly where they occur — keep the existing affordance/`respond` wiring. Optional: a date divider and streaming "typing" indicator if cheap.
- Preserve error surfacing: an `⚠️ <message>` assistant bubble on errors (already in the hook).

### Input row
- Text input ("Ask about your finances…") + **send** button (keep Enter-to-send).
- **Attach button** (paperclip): opens a file picker for PDFs and runs the **existing** import pipeline. Reuse `PDFUploadZone`'s logic or lift its pipeline: `pdfsFromFileList` → `extractTextFromPDF` per file → `POST /api/classify` (with the stored key header) → commit the returned `PendingTransaction[]` the same way `ImportPanel.handleTransactionsClassified` does → `notifyDataChanged()`. Show progress/result inline in the chat (e.g. an assistant/system bubble "Imported N transactions from statement.pdf"). If the full commit path proves large, it is acceptable to **ship the panel + markdown first and land attachments as a follow-up commit** — call that out rather than half-wiring it. Do not silently drop imported data.

### Styling notes
- Use existing CSS variables/tokens and Tailwind classes already in the app (borders, radii, shadows, surfaces, fonts). The panel should look like it belongs to Wealthwise, not a third-party widget. Verify both light and dark themes.

---

## Workstream C — Markdown rendering for chat messages

**Goal:** assistant messages render markdown (lists, bold/italic, headings, code, links, tables) for better readability.

- **Library:** add `react-markdown` + `remark-gfm`. Render assistant message text through it in `ChatPanel` (user messages can stay plain text, or also markdown — assistant is the priority).
- **Security:** do NOT enable raw HTML (no `rehype-raw`). `react-markdown` escapes HTML by default — keep it that way (model output is untrusted for rendering purposes). Render links with `target="_blank" rel="noopener noreferrer"`.
- **Styling:** style the rendered markdown to match the app (headings, list spacing, `code`/`pre` with a subtle surface, tables scrollable in an `overflow-x:auto` wrapper). Keep it tight inside the bubble. Ensure it works in dark mode.
- **Streaming:** markdown must render incrementally as text streams in (re-render the partial markdown each delta — fine for `react-markdown`).
- **Test:** a small unit/render test that a markdown string (e.g. `**bold**`, a list, a link) produces the expected elements/attributes (e.g. link has `rel="noopener noreferrer"`), and that raw HTML in the input is not rendered as HTML.

---

## Suggested build order (each an independently testable commit)

1. **Workstream C (markdown)** — smallest, isolated; add the dep + render + test. (Do the `openai`-style intentional lockfile commit note: `react-markdown`/`remark-gfm` are new deps, so package.json + package-lock.json changes are intended here.)
2. **Workstream B layout** — right-docked overlay panel + header (icon/name/new-chat/minimize) + bubbles + input, reusing the existing hook/affordances; add `reset()` to the hook. (Manual-verification UI + `tsc` clean + suite green; no brittle DOM test required, but keep any hook-logic changes unit-covered.)
3. **Workstream B attachments** — wire the attach button to the existing PDF pipeline (or land as an explicit follow-up if large).
4. **Workstream A docs** — the local-test section (can be folded into step 1's commit).

## Testing
- `npm test` green and `npx tsc --noEmit` clean at every commit.
- Markdown: unit/render test (above).
- Panel/attachments: manual verification via `npm run dev` (there is no browser test harness) — confirm: opens/minimizes, new-chat resets, streaming + markdown render, affordances/confirm cards still work, error `⚠️` still shows, attach imports a PDF and the main table updates (`notifyDataChanged`). Note what was manually verified in the report.

## Out of scope
- Emoji picker; online-status line; changing the agent loop, tools, gating, providers, knowledge, or memory. Merge/PR decisions.

## Open items to confirm at session start (defaults in brackets — proceed with the default if the owner is unavailable)
- Panel width [~400px] and whether it goes full-width on mobile [yes].
- Whether user messages also render markdown [assistant only is fine].
- Whether attach lands in this spec or as a follow-up if the commit path is large [land if tractable; else explicit follow-up].
