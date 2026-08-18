'use client';
import { useCallback, useRef, useState } from 'react';
import { getAgentKeyHeaders } from '@/lib/apiKey';
import { notifyDataChanged } from '@/lib/dataEvents';
import { getViewContext } from '@/app/lib/viewContext';
import type { UIAffordance } from '@/lib/agent/ui';
import type { PendingTransaction } from '@/types';

// Splits an SSE byte stream on the `\n\n` frame delimiter and JSON-parses each
// `data: ` line. Pure so it can be unit-tested without a fetch/ReadableStream
// harness — the hook below is the only caller, feeding it the buffer built up
// across successive reader.read() chunks.
export function parseSSEChunk(buffer: string): { events: any[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const events = parts
    .map((p) => p.replace(/^data: /, '').trim())
    .filter(Boolean)
    .map((p) => JSON.parse(p));
  return { events, rest };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  thinkingMs?: number;
}

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [affordances, setAffordances] = useState<UIAffordance[]>([]);
  const [streaming, setStreaming] = useState(false);
  // Live status label for a slow tool (e.g. deep_research): "Researching… (N sources)".
  const [progress, setProgress] = useState<string | null>(null);
  const convId = useRef<string | null>(null);
  const thinkStart = useRef<number | null>(null);

  // Stamp the elapsed thinking time onto the last assistant message and stop the
  // timer. No-op when no thinking was streamed for this turn.
  const finalizeThinking = useCallback(() => {
    if (thinkStart.current == null) return;
    const ms = Date.now() - thinkStart.current;
    thinkStart.current = null;
    setMessages((m) => {
      const c = [...m];
      const last = c[c.length - 1];
      c[c.length - 1] = { ...last, thinkingMs: ms };
      return c;
    });
  }, []);

  // Consume an SSE response, dispatching each event through the same parsing
  // path for both the initial send and an action resume.
  const consume = useCallback(async (res: Response) => {
    if (!res.ok) {
      const errText = await res.text();
      setMessages((m) => {
        const c = [...m];
        c[c.length - 1] = { role: 'assistant', text: `⚠️ ${errText || res.statusText}` };
        return c;
      });
      return;
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const { events, rest } = parseSSEChunk(buf);
      buf = rest;
      for (const e of events) {
        if (e.type === 'conversation') convId.current = e.conversationId;
        else if (e.type === 'progress') setProgress(e.label);
        else if (e.type === 'thinking') {
          if (thinkStart.current == null) thinkStart.current = Date.now();
          setMessages((m) => {
            const c = [...m];
            const last = c[c.length - 1];
            c[c.length - 1] = { ...last, thinking: (last.thinking ?? '') + e.delta };
            return c;
          });
        } else if (e.type === 'text') {
          setProgress(null); // the answer has started — drop any tool-progress label
          setMessages((m) => {
            const c = [...m];
            const last = c[c.length - 1];
            // First token of the answer: close out the thinking timer.
            const done = !last.text && thinkStart.current != null;
            const thinkingMs = done ? Date.now() - thinkStart.current! : last.thinkingMs;
            if (done) thinkStart.current = null;
            c[c.length - 1] = { ...last, text: last.text + e.delta, thinkingMs };
            return c;
          });
        } else if ((e.type === 'proposal' || e.type === 'proposal_batch') && e.affordance) {
          finalizeThinking();
          setAffordances((a) => [...a, e.affordance as UIAffordance]);
        } else if (e.type === 'error') {
          // The server hit a mid-stream provider error. The HTTP response was
          // already 200 (so res.ok passed and the catch below never fires) and a
          // clean EOF is not a throw — without this the user would see an empty
          // bubble. Surface it the same way the non-ok/catch paths do.
          finalizeThinking();
          setMessages((m) => {
            const c = [...m];
            const last = c[c.length - 1];
            c[c.length - 1] = { ...last, role: 'assistant', text: `⚠️ ${e.message}` };
            return c;
          });
        }
      }
    }
    // Stream ended cleanly (loop exit) — stamp any still-open thinking timer so a
    // thinking-only turn still shows a duration, and drop any tool-progress label.
    finalizeThinking();
    setProgress(null);
  }, [finalizeThinking]);

  const send = useCallback(
    async (
      text: string,
      attachment?: { fileName: string; transactions: PendingTransaction[] },
      images?: { mediaType: string; data: string }[],
    ) => {
      thinkStart.current = null;
      setProgress(null);
      setAffordances([]);
      setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '' }]);
      setStreaming(true);
      try {
        const res = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAgentKeyHeaders() },
          body: JSON.stringify({
            conversationId: convId.current,
            message: text,
            viewContext: getViewContext(),
            ...(attachment ? { attachment } : {}),
            ...(images && images.length > 0 ? { images } : {}),
          }),
        });
        await consume(res);
      } catch {
        setMessages((m) => {
          const c = [...m];
          c[c.length - 1] = { role: 'assistant', text: '⚠️ Something went wrong. Please try again.' };
          return c;
        });
      } finally {
        setStreaming(false);
      }
    },
    [consume],
  );

  // Start a fresh conversation: drop local transcript + affordances and forget
  // the server conversation id (the next send creates a new one server-side).
  // The caller gates this on `!streaming`, so we never clear mid-stream out from
  // under `consume`, which appends to the last message.
  const reset = useCallback(() => {
    convId.current = null;
    setMessages([]);
    setAffordances([]);
  }, []);

  // Append a local assistant bubble without a server round-trip. Used by the
  // PDF-attach flow to report its result inline in the transcript.
  const notify = useCallback((text: string) => {
    setMessages((m) => [...m, { role: 'assistant', text }]);
  }, []);

  // Load a past conversation's transcript from the server and make it the
  // active conversation (subsequent sends continue it). Gated on !streaming
  // for the same reason as `reset`.
  const loadConversation = useCallback(
    async (id: string) => {
      if (streaming) return;
      const res = await fetch(`/api/agent/conversations/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []);
      setAffordances([]);
      convId.current = id;
    },
    [streaming],
  );

  const respond = useCallback(
    async (
      token: string,
      decision: 'approve' | 'deny',
      value?: unknown,
      scope?: 'once' | 'always',
    ) => {
      // A tokenless suggestion is just a canned prompt — replay it as a send.
      if (!token) {
        if (typeof value === 'string') await send(value);
        return;
      }
      thinkStart.current = null;
      setProgress(null);
      setAffordances((a) => a.filter((x) => !('token' in x) || x.token !== token));
      setMessages((m) => [...m, { role: 'assistant', text: '' }]);
      setStreaming(true);
      try {
        const res = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAgentKeyHeaders() },
          body: JSON.stringify({
            conversationId: convId.current,
            action: { token, decision, value, ...(scope ? { scope } : {}) },
          }),
        });
        await consume(res);
        // A gated write tool is the only thing that produces a confirm
        // affordance, so an approved decision that streamed successfully
        // means a mutation ran — refresh the main tables/charts.
        if (res.ok && decision === 'approve') notifyDataChanged();
      } catch {
        setMessages((m) => {
          const c = [...m];
          c[c.length - 1] = { role: 'assistant', text: '⚠️ Something went wrong. Please try again.' };
          return c;
        });
      } finally {
        setStreaming(false);
      }
    },
    [consume, send],
  );

  return { messages, affordances, streaming, progress, send, respond, reset, notify, loadConversation };
}

export type AgentChat = ReturnType<typeof useAgentChat>;
