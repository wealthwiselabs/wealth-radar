'use client';
import { useState } from 'react';
import { formatThoughtDuration } from '@/lib/agent/thinking';

export default function ThinkingPanel({
  thinking, thinkingMs, hasAnswer,
}: { thinking: string; thinkingMs?: number; hasAnswer: boolean }) {
  const [open, setOpen] = useState(!hasAnswer);
  const label = thinkingMs != null ? `Thought for ${formatThoughtDuration(thinkingMs)}` : 'Thinking…';
  return (
    <div className="mb-[var(--space-2)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-[var(--space-1)] text-xsmall text-[var(--color-text-base-subdued)] hover:text-[var(--color-text-base-default)]"
        aria-expanded={open}
      >
        <span>✨ {label}</span>
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
