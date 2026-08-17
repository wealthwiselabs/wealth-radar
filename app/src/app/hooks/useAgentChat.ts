'use client';
import { useCallback, useRef, useState } from 'react';
import { getStoredApiKey } from '@/lib/apiKey';

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
  const [streaming, setStreaming] = useState(false);
  const convId = useRef<string | null>(null);

  const send = useCallback(async (text: string) => {
    setMessages((m) => [...m, { role: 'user', text }, { role: 'assistant', text: '' }]);
    setStreaming(true);
    const res = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-api-key': getStoredApiKey() },
      body: JSON.stringify({ conversationId: convId.current, message: text }),
    });
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
      }
    }
    setStreaming(false);
  }, []);

  return { messages, streaming, send };
}
