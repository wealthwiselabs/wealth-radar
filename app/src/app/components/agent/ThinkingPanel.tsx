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
  thinking, thinkingMs, hasAnswer,
}: { thinking: string; thinkingMs?: number; hasAnswer: boolean }) {
  const [open, setOpen] = useState(!hasAnswer);
  const active = thinkingMs == null; // still reasoning (no duration stamped yet)
  return (
    <div className="mb-[var(--space-2)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-[var(--space-1)] text-xsmall text-[var(--color-text-base-subdued)] hover:text-[var(--color-text-base-default)]"
        aria-expanded={open}
      >
        <span>✨ {active ? 'Thinking' : `Thought for ${formatThoughtDuration(thinkingMs!)}`}</span>
        {active ? <LiveDots /> : null}
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-[var(--space-1)] max-h-40 overflow-y-auto whitespace-pre-wrap border-l-2 border-[var(--color-border-base-subdued)] pl-[var(--space-3)] text-xsmall text-[var(--color-text-base-subdued)]">
          {thinking}
        </div>
      )}
    </div>
  );
}
