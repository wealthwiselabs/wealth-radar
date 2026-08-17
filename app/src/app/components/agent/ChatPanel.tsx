'use client';
import { useEffect, useRef, useState } from 'react';
import Affordances from '@/app/components/agent/Affordances';
import MarkdownMessage from '@/app/components/agent/MarkdownMessage';
import AssistantIcon from '@/app/components/agent/AssistantIcon';
import type { AgentChat } from '@/app/hooks/useAgentChat';

const iconBtn =
  'inline-flex items-center justify-center h-8 w-8 rounded-[var(--radius-2)] ' +
  'text-[var(--color-icon-base-default)] transition-colors ' +
  'hover:bg-[var(--color-background-base-hover)] hover:text-[var(--color-text-base-default)] ' +
  'disabled:opacity-40 disabled:pointer-events-none';

// Presentational chat surface. All conversation state is owned by AgentWidget
// (so it survives minimizing) and threaded in via `chat`.
export default function ChatPanel({
  open,
  onMinimize,
  chat,
}: {
  open: boolean;
  onMinimize: () => void;
  chat: AgentChat;
}) {
  const { messages, affordances, streaming, send, respond, reset } = chat;
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Move focus to the input each time the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the newest content in view, including on every streaming delta.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, affordances, streaming]);

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    send(text);
    setDraft('');
  };

  return (
    <div
      role="dialog"
      aria-label="Wealthwise Advisor"
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onMinimize();
      }}
    >
      <header className="flex items-center gap-[var(--space-3)] border-b border-[var(--color-border-base-subdued)] px-[var(--space-4)] py-[var(--space-3)]">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-2)] bg-[var(--color-background-brand-default)] text-[var(--color-text-inverse)]">
          <AssistantIcon className="h-5 w-5" />
        </span>
        <span className="heading-xsmall flex-1 truncate text-[var(--color-text-base-default)]">
          Wealthwise Advisor
        </span>
        <button
          type="button"
          aria-label="New chat"
          title="New chat"
          onClick={reset}
          disabled={streaming || messages.length === 0}
          className={iconBtn}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Minimize"
          title="Minimize"
          onClick={onMinimize}
          className={iconBtn}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </header>

      <div className="flex-1 space-y-[var(--space-3)] overflow-y-auto px-[var(--space-4)] py-[var(--space-4)]">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          messages.map((m, i) => (
            <Bubble key={i} role={m.role} text={m.text} streaming={streaming} />
          ))
        )}
        <Affordances affordances={affordances} respond={respond} disabled={streaming} />
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-center gap-[var(--space-2)] border-t border-[var(--color-border-base-subdued)] p-[var(--space-3)]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={inputRef}
          className="origin-input flex-1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about your finances…"
          aria-label="Message"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={streaming || !draft.trim()}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-2)] bg-[var(--color-background-brand-default)] text-[var(--color-text-inverse)] transition hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
            />
          </svg>
        </button>
      </form>
    </div>
  );
}

function Bubble({
  role,
  text,
  streaming,
}: {
  role: 'user' | 'assistant';
  text: string;
  streaming: boolean;
}) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-[var(--radius-3)] px-[var(--space-3)] py-[var(--space-2)] text-small ${
          isUser
            ? 'rounded-br-[var(--radius-1)] bg-[var(--color-background-brand-default)] text-[var(--color-text-inverse)]'
            : 'rounded-bl-[var(--radius-1)] bg-[var(--color-background-base-subdued)] text-[var(--color-text-base-default)]'
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{text}</span>
        ) : text ? (
          <MarkdownMessage text={text} />
        ) : streaming ? (
          <TypingDots />
        ) : null}
      </div>
    </div>
  );
}

// Three-dot streaming indicator shown in the assistant bubble before the first
// token arrives.
function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1" aria-label="Assistant is typing">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--color-text-base-disabled)]"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[var(--space-3)] px-[var(--space-4)] text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-background-brand-subdued)] text-[var(--color-text-brand)]">
        <AssistantIcon className="h-7 w-7" />
      </span>
      <p className="text-small font-medium text-[var(--color-text-base-default)]">
        Ask about your finances
      </p>
      <p className="text-xsmall text-[var(--color-text-base-subdued)]">
        Spending, budgets, and trends across your accounts — or attach a statement PDF to import
        it.
      </p>
    </div>
  );
}
