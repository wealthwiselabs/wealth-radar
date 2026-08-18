'use client';
import { useEffect, useState } from 'react';

interface ConversationSummary {
  id: string;
  title: string;
  modifiedAt: string;
  messageCount: number;
}

// Tiny relative-time formatter (seconds/minutes/hours/days ago) — avoids
// pulling in a date library for a single label.
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

const iconBtn =
  'inline-flex items-center justify-center h-8 w-8 rounded-[var(--radius-2)] ' +
  'text-[var(--color-icon-base-default)] transition-colors ' +
  'hover:bg-[var(--color-background-base-hover)] hover:text-[var(--color-text-base-default)] ' +
  'disabled:opacity-40 disabled:pointer-events-none';

// Full-height list of past conversations, shown in the message area in place
// of the transcript when the user opens history from the header.
export default function HistoryView({
  onOpen,
  onNew,
  onClose,
}: {
  onOpen: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agent/conversations');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setConversations(data.conversations ?? []);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDelete = async (id: string) => {
    setConversations((c) => c.filter((conv) => conv.id !== id));
    try {
      await fetch('/api/agent/conversations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {
      // Best-effort: the row is already gone from the list locally.
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-[var(--space-2)] pb-[var(--space-2)]">
        <span className="heading-xsmall flex-1 text-[var(--color-text-base-default)]">Chats</span>
        <button
          type="button"
          aria-label="Close history"
          title="Close"
          onClick={onClose}
          className={iconBtn}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        onClick={onNew}
        className="origin-btn origin-btn-secondary mb-[var(--space-2)] w-full justify-center"
      >
        + New chat
      </button>

      <div className="flex-1 space-y-[var(--space-1)] overflow-y-auto">
        {loaded && conversations.length === 0 ? (
          <p className="px-[var(--space-2)] py-[var(--space-3)] text-center text-xsmall text-[var(--color-text-base-subdued)]">
            No past chats yet.
          </p>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className="origin-card flex w-full items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] transition-colors hover:bg-[var(--color-background-base-hover)]"
            >
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-small text-[var(--color-text-base-default)]">
                  {c.title}
                </span>
                <span className="block text-xsmall text-[var(--color-text-base-subdued)]">
                  {relativeTime(c.modifiedAt)} · {c.messageCount} msgs
                </span>
              </button>
              <button
                type="button"
                aria-label="Delete conversation"
                title="Delete"
                onClick={() => handleDelete(c.id)}
                className={iconBtn}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v13a1 1 0 01-1 1H8a1 1 0 01-1-1V7h10zM10 11v6M14 11v6"
                  />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
