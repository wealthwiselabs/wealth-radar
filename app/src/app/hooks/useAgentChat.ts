'use client';
import { useCallback, useRef, useState } from 'react';
import { getAgentKeyHeaders } from '@/lib/apiKey';
import { notifyDataChanged } from '@/lib/dataEvents';
import type { UIAffordance } from '@/lib/agent/ui';

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
}

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [affordances, setAffordances] = useState<UIAffordance[]>([]);
  const [streaming, setStreaming] = useState(false);
  const convId = useRef<string | null>(null);

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
        else if (e.type === 'text')
          setMessages((m) => {
            const c = [...m];
            c[c.length - 1] = { role: 'assistant', text: c[c.length - 1].text + e.delta };
            return c;
          });
        else if (e.type === 'proposal' && e.affordance)
          setAffordances((a) => [...a, e.affordance as UIAffordance]);
      }
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      setAffordances([]);
      setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '' }]);
      setStreaming(true);
      try {
        const res = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAgentKeyHeaders() },
          body: JSON.stringify({ conversationId: convId.current, message: text }),
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

  const respond = useCallback(
    async (token: string, decision: 'approve' | 'deny', value?: unknown) => {
      // A tokenless suggestion is just a canned prompt — replay it as a send.
      if (!token) {
        if (typeof value === 'string') await send(value);
        return;
      }
      setAffordances((a) => a.filter((x) => !('token' in x) || x.token !== token));
      setMessages((m) => [...m, { role: 'assistant', text: '' }]);
      setStreaming(true);
      try {
        const res = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAgentKeyHeaders() },
          body: JSON.stringify({ conversationId: convId.current, action: { token, decision, value } }),
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

  return { messages, affordances, streaming, send, respond };
}
