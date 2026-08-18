'use client';
import { useEffect, useState } from 'react';
import { useAgentChat } from '@/app/hooks/useAgentChat';
import ChatPanel from './ChatPanel';
import AssistantIcon from './AssistantIcon';
import { clampPanelWidth } from './panelWidth';

const WIDTH_STORAGE_KEY = 'wealthwise:chat-panel-width';

// Right-docked assistant. The chat state lives here (not in ChatPanel) so the
// conversation survives minimizing and reopening — the panel is always mounted
// and only slides off-screen when closed. AgentWidget itself is mounted once in
// the root layout, so its hook state persists for the life of the page.
export default function AgentWidget() {
  const [open, setOpen] = useState(false);
  const chat = useAgentChat();

  // On wide viewports the open panel PUSHES the page (see the padding-right
  // effect below); on narrow it stays a full-width overlay. Track the media
  // query live so a resize across the breakpoint switches modes.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(min-width:1024px)');
    setWide(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Persisted, clamped panel width (only used in wide mode). Seed from
  // localStorage inside an effect so SSR never touches window/localStorage.
  // Default is a comfortably wide dock; users can drag it narrower/wider.
  const [width, setWidth] = useState(520);
  useEffect(() => {
    const stored = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) {
      setWidth(clampPanelWidth(stored, window.innerWidth));
    }
  }, []);

  // Push the page content aside by reserving room on the right while the panel
  // is open in wide mode. Cleared when closed, narrow, or unmounted.
  useEffect(() => {
    const shell = document.getElementById('app-shell');
    if (!shell) return;
    shell.style.paddingRight = open && wide ? `${width}px` : '';
    return () => {
      shell.style.paddingRight = '';
    };
  }, [open, wide, width]);

  const onWidth = (px: number) => {
    const w = clampPanelWidth(px, window.innerWidth);
    setWidth(w);
    localStorage.setItem(WIDTH_STORAGE_KEY, String(w));
  };

  return (
    <>
      {/* Launcher — floats bottom-right, fades out while the panel is open. */}
      <button
        type="button"
        aria-label="Open Wealthwise Advisor"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`fixed bottom-[var(--space-6)] right-[var(--space-6)] z-40 h-14 w-14 rounded-full
          flex items-center justify-center shadow-[var(--elevation-high-shadow)]
          bg-[var(--color-background-brand-default)] text-[var(--color-text-inverse)]
          transition-all duration-200 hover:brightness-110
          ${open ? 'pointer-events-none scale-90 opacity-0' : 'scale-100 opacity-100'}`}
      >
        <AssistantIcon className="h-7 w-7" />
      </button>

      {/* Panel — full-height overlay on the right. Always mounted; translated
          off-screen when closed so the transcript is preserved. */}
      <div
        className={`fixed top-0 right-0 z-50 h-[100dvh] w-full sm:w-[400px]
          bg-[var(--color-background-base-default)]
          border-l border-[var(--color-border-base-default)]
          shadow-[var(--elevation-high-shadow)]
          transition-transform duration-300 ease-out
          ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}
        style={wide ? { width: `${width}px`, maxWidth: '100vw' } : undefined}
        aria-hidden={!open}
      >
        <ChatPanel
          open={open}
          onMinimize={() => setOpen(false)}
          chat={chat}
          wide={wide}
          width={width}
          onWidth={onWidth}
        />
      </div>
    </>
  );
}
