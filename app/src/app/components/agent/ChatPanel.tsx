'use client';
import { useState } from 'react';
import { useAgentChat } from '@/app/hooks/useAgentChat';

export default function ChatPanel() {
  const { messages, streaming, send } = useAgentChat();
  const [draft, setDraft] = useState('');
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <span className="inline-block rounded px-2 py-1 bg-black/5 dark:bg-white/10 whitespace-pre-wrap">
              {m.text || (streaming ? '…' : '')}
            </span>
          </div>
        ))}
      </div>
      <form
        className="p-2 border-t flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) {
            send(draft);
            setDraft('');
          }
        }}
      >
        <input
          className="flex-1 rounded border px-2 py-1 bg-transparent"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about your finances…"
        />
        <button className="rounded px-3 py-1 bg-black/80 text-white" disabled={streaming}>
          Send
        </button>
      </form>
    </div>
  );
}
