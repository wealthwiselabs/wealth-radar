'use client';
import { useEffect, useRef, useState } from 'react';
import Affordances from '@/app/components/agent/Affordances';
import MarkdownMessage from '@/app/components/agent/MarkdownMessage';
import ThinkingPanel from '@/app/components/agent/ThinkingPanel';
import AssistantIcon from '@/app/components/agent/AssistantIcon';
import HistoryView from '@/app/components/agent/HistoryView';
import type { AgentChat } from '@/app/hooks/useAgentChat';
import { getStoredApiKey } from '@/lib/apiKey';
import { pdfsFromFileList, pdfsFromDataTransfer } from '@/lib/pdfBatch';
import { parsePdfsViaChat } from '@/lib/agentPdfImport';
import type { PendingTransaction } from '@/types';

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
  wide,
  width,
  onWidth,
}: {
  open: boolean;
  onMinimize: () => void;
  chat: AgentChat;
  wide?: boolean;
  width?: number;
  onWidth?: (px: number) => void;
}) {
  const { messages, affordances, streaming, send, respond, reset, notify, loadConversation } = chat;
  const [draft, setDraft] = useState('');
  const [parsing, setParsing] = useState(false);
  const [staged, setStaged] = useState<{
    fileName: string;
    transactions: PendingTransaction[];
  } | null>(null);
  // Images attached to the NEXT user turn only (not persisted). `url` is the full
  // data URL used for the thumbnail; `mediaType`/`data` are sent to the model.
  const [images, setImages] = useState<{ mediaType: string; data: string; url: string }[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = streaming || parsing;

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
    // Allow sending with images even when the text box is empty (image-only turn).
    if ((!text && images.length === 0) || busy) return;
    // The staged statement (if any) rides along with this message; the agent
    // decides whether to import it (via import_statement) or just answer.
    send(
      text,
      staged ?? undefined,
      images.length > 0 ? images.map(({ mediaType, data }) => ({ mediaType, data })) : undefined,
    );
    setStaged(null);
    setImages([]);
    setDraft('');
    // Collapse the textarea back to a single row now that it's empty.
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  // Auto-grow the message textarea as the user types, up to MAX_INPUT_HEIGHT
  // (~5 lines), then let it scroll. Shrinks back down as text is removed.
  const MAX_INPUT_HEIGHT = 140;
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  };

  // Attach/drop → PARSE bank-statement PDFs (extract + classify) and STAGE the
  // result. Nothing is committed here; the user's next message decides what the
  // agent does with it. Multiple files fold into one staged batch.
  const stageFiles = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    setParsing(true);
    try {
      const { staged: rows, errors } = await parsePdfsViaChat(files, getStoredApiKey());
      if (rows.length > 0) {
        const combined =
          rows.length === 1
            ? rows[0]
            : {
                fileName: `${rows.length} files`,
                transactions: rows.flatMap((r) => r.transactions),
              };
        setStaged(combined);
      }
      for (const err of errors) notify(`⚠️ ${err.file}: ${err.message}`);
    } catch (err) {
      notify(`⚠️ ${err instanceof Error ? err.message : 'Could not read the PDF. Please try again.'}`);
    } finally {
      setParsing(false);
    }
  };

  // Read one image file into a base64 attachment and append it to `images`
  // (capped at 4). The full data URL doubles as the thumbnail preview src.
  const readImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const comma = dataUrl.indexOf(',');
      if (comma === -1) return;
      const data = dataUrl.slice(comma + 1);
      setImages((prev) =>
        prev.length >= 4 ? prev : [...prev, { mediaType: file.type, data, url: dataUrl }],
      );
    };
    reader.readAsDataURL(file);
  };

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Route image files to the vision path; PDFs go through the existing staging
    // path (pdfsFromFileList filters the FileList down to real PDFs on its own).
    const picked = e.target.files ? Array.from(e.target.files) : [];
    const pdfs = pdfsFromFileList(e.target.files);
    e.target.value = ''; // allow re-picking the same file
    for (const f of picked) {
      if (f.type.startsWith('image/')) readImage(f);
    }
    await stageFiles(pdfs);
  };

  return (
    <div
      role="dialog"
      aria-label="Wealthwise Advisor"
      className="relative flex h-full flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onMinimize();
      }}
      onDragOver={(e) => {
        if (busy) return;
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragActive(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setDragActive(false);
        if (busy) return;
        const files = await pdfsFromDataTransfer(e.dataTransfer);
        await stageFiles(files);
      }}
    >
      {dragActive ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius-3)] border-2 border-dashed border-[var(--color-border-brand-default)] bg-[var(--color-background-brand-subdued)]/80">
          <span className="text-small font-medium text-[var(--color-text-brand)]">
            Drop a statement PDF
          </span>
        </div>
      ) : null}
      {wide ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat panel"
          tabIndex={0}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize touch-none select-none hover:bg-[var(--color-border-base-hover)]"
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              onWidth?.(window.innerWidth - e.clientX);
            }
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onPointerCancel={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onKeyDown={(e) => {
            // Panel is docked right, so ArrowLeft grows it and ArrowRight shrinks it.
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              onWidth?.((width ?? 400) + 16);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              onWidth?.((width ?? 400) - 16);
            }
          }}
        />
      ) : null}
      <header className="flex items-center gap-[var(--space-3)] border-b border-[var(--color-border-base-subdued)] px-[var(--space-4)] py-[var(--space-3)]">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-2)] bg-[var(--color-background-brand-default)] text-[var(--color-text-inverse)]">
          <AssistantIcon className="h-5 w-5" />
        </span>
        <span className="heading-xsmall flex-1 truncate text-[var(--color-text-base-default)]">
          Wealthwise Advisor
        </span>
        <button
          type="button"
          aria-label="Chat history"
          title="History"
          onClick={() => setShowHistory(true)}
          className={iconBtn}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label="New chat"
          title="New chat"
          onClick={reset}
          disabled={streaming || messages.length === 0}
          className={iconBtn}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="flex-1 space-y-[var(--space-3)] overflow-y-auto px-[var(--space-4)] py-[var(--space-4)]">
        {showHistory ? (
          <HistoryView
            onOpen={(id) => {
              setStaged(null);
              setImages([]);
              loadConversation(id);
              setShowHistory(false);
            }}
            onNew={() => {
              setStaged(null);
              setImages([]);
              reset();
              setShowHistory(false);
            }}
            onClose={() => setShowHistory(false)}
          />
        ) : (
          <>
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              messages.map((m, i) => {
                const isLast = i === messages.length - 1;
                // Drop assistant turns that never produced text or thinking (e.g. a
                // resume that only ran a tool), except the live streaming one, which
                // shows the typing dots.
                if (m.role === 'assistant' && !m.text && !m.thinking && !(isLast && streaming))
                  return null;
                return (
                  <Bubble
                    key={i}
                    role={m.role}
                    text={m.text}
                    thinking={m.thinking}
                    thinkingMs={m.thinkingMs}
                    streaming={streaming}
                  />
                );
              })
            )}
            <Affordances affordances={affordances} respond={respond} disabled={streaming} />
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {staged || images.length > 0 ? (
        <div className="flex flex-wrap items-center gap-[var(--space-2)] border-t border-[var(--color-border-base-subdued)] px-[var(--space-3)] pt-[var(--space-2)]">
          {staged ? (
            <span className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-2)] bg-[var(--color-background-base-subdued)] px-[var(--space-2)] py-[var(--space-1)] text-xsmall text-[var(--color-text-base-default)]">
              <span className="truncate">
                📄 {staged.fileName} — {staged.transactions.length} transaction
                {staged.transactions.length === 1 ? '' : 's'} parsed
              </span>
              <button
                type="button"
                aria-label="Remove staged statement"
                title="Remove staged statement"
                onClick={() => setStaged(null)}
                className="text-[var(--color-icon-base-default)] hover:text-[var(--color-text-base-default)]"
              >
                ✕
              </button>
            </span>
          ) : null}
          {images.map((img, i) => (
            <span key={i} className="relative inline-flex">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={`Attached image ${i + 1}`}
                className="h-10 w-10 rounded-[var(--radius-2)] object-cover"
              />
              <button
                type="button"
                aria-label="Remove image"
                title="Remove image"
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-background-base-default)] text-xsmall leading-none text-[var(--color-icon-base-default)] shadow hover:text-[var(--color-text-base-default)]"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <form
        className="flex items-end gap-[var(--space-2)] border-t border-[var(--color-border-base-subdued)] p-[var(--space-3)]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf,image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={handleFiles}
          className="hidden"
        />
        <button
          type="button"
          aria-label="Attach a statement PDF"
          title="Attach a statement PDF"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className={iconBtn}
        >
          {parsing ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              />
            </svg>
          )}
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          className="origin-input flex-1 resize-none"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            autoGrow(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            // Pull any pasted image files into the vision attachments. Only swallow
            // the paste when at least one image was found, so plain-text paste works.
            let found = false;
            const items = e.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              if (item.kind === 'file' && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                  readImage(file);
                  found = true;
                }
              }
            }
            if (found) e.preventDefault();
          }}
          placeholder={parsing ? 'Reading statement…' : 'Ask about your finances…'}
          aria-label="Message"
          disabled={parsing}
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={busy || (!draft.trim() && images.length === 0)}
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
  thinking,
  thinkingMs,
  streaming,
}: {
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  thinkingMs?: number;
  streaming: boolean;
}) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-[var(--radius-3)] px-[var(--space-3)] py-[var(--space-2)] text-small ${
          isUser
            ? 'rounded-br-[var(--radius-1)] bg-[var(--color-background-brand-subdued)] text-[var(--color-text-base-default)]'
            : 'rounded-bl-[var(--radius-1)] bg-[var(--color-background-base-hover)] text-[var(--color-text-base-default)]'
        }`}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{text}</span>
        ) : (
          <>
            {thinking ? (
              <ThinkingPanel thinking={thinking} thinkingMs={thinkingMs} hasAnswer={!!text} />
            ) : null}
            {text ? (
              <MarkdownMessage text={text} />
            ) : streaming && !thinking ? (
              <TypingDots />
            ) : null}
          </>
        )}
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
