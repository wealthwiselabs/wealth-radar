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
  thinking, thinkingMs,
}: { thinking: string; thinkingMs?: number }) {
  // Collapsed by default — the animated "Thinking…" chip shows it's working; the
  // user expands to watch the reasoning stream if they want to.
  const [open, setOpen] = useState(false);
  const active = thinkingMs == null; // still reasoning (no duration stamped yet)
  return (
    // A tinted, bordered card so the model's reasoning reads as distinctly
    // separate from the answer markdown that follows it in the same bubble.
    <div className="mb-[var(--space-2)] overflow-hidden rounded-[var(--radius-2)] border border-[var(--color-border-base-subdued)] bg-[var(--color-background-accent-subdued)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1)] text-xsmall text-[var(--color-text-base-subdued)] hover:text-[var(--color-text-base-default)]"
        aria-expanded={open}
      >
        <span className="font-medium">
          ✨ {active ? 'Thinking' : `Thought for ${formatThoughtDuration(thinkingMs!)}`}
        </span>
        {active ? <LiveDots /> : null}
        <span aria-hidden className="ml-auto text-[1rem] leading-none">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-[var(--color-border-base-subdued)] px-[var(--space-2)] py-[var(--space-1)] text-xsmall italic text-[var(--color-text-base-subdued)]">
          {thinking}
        </div>
      )}
    </div>
  );
}
