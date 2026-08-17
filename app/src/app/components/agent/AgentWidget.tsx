'use client';
import { useState } from 'react';
import ChatPanel from './ChatPanel';

export default function AgentWidget() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        aria-label="Open financial assistant"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 right-4 z-40 rounded-full w-12 h-12 shadow-lg bg-black/85 text-white"
      >
        💬
      </button>
      {open && (
        <div className="fixed bottom-20 right-4 z-40 w-96 h-[32rem] rounded-xl shadow-2xl border bg-white dark:bg-neutral-900 overflow-hidden">
          <ChatPanel />
        </div>
      )}
    </>
  );
}
