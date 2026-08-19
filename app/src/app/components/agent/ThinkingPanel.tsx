'use client';
import { useState } from 'react';
import { formatThoughtDuration } from '@/lib/agent/thinking';

// Small animated dots so the label reads as alive even between reasoning chunks.
function LiveDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[0, 150, 300].map((d) => (
        <span
          key={d}
          className="h-1 w-1 animate-bounce rounded-full bg-current"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  );
}

export default function ThinkingPanel({
  thinking, thinkingMs, live = false,
}: { thinking: string; thinkingMs?: number; live?: boolean }) {
  // Collapsed by default — the animated "Thinking…" chip shows it's working; the
  // user expands to watch the reasoning stream if they want to. Rendered as its
  // own understated line above the answer bubble (not inside it), so reasoning
  // reads as a separate, secondary message rather than part of the response.
  const [open, setOpen] = useState(false);
  // Only the live, still-streaming turn shows the animated "Thinking…" dots.
  // Tying this to `live` (not just an unstamped duration) guarantees the dots
  // stop when the turn ends, even if the timing stamp was missed or the message
  // came from loaded history.
  const active = live && thinkingMs == null;
  const label = active
    ? 'Thinking'
    : thinkingMs != null
      ? `Thought for ${formatThoughtDuration(thinkingMs)}`
      : 'Thought';
  return (
    <div className="text-xsmall text-[var(--color-text-base-subdued)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-[var(--space-1)] hover:text-[var(--color-text-base-default)]"
        aria-expanded={open}
      >
        <span>✨ {label}</span>
        {active ? <LiveDots /> : null}
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 4 10 8 6 12" />
        </svg>
      </button>
      {open && (
        <div className="mt-[var(--space-1)] max-h-40 overflow-y-auto whitespace-pre-wrap border-l-2 border-[var(--color-border-base-subdued)] pl-[var(--space-2)] italic">
          {thinking}
        </div>
      )}
    </div>
  );
}
