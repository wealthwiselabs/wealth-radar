// SSE helpers for the agent chat route. Kept OUT of route.ts because Next.js
// App Router route modules may only export HTTP-method handlers (GET/POST/...)
// and a small allowlist — exporting arbitrary functions from a route file
// fails `next build`'s route-type validation. These are pure and unit-tested
// here instead.
import type { LoopEvent } from '@/lib/agent/loop';

export function sseEncode(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function* streamLoopToSSE(loop: AsyncIterable<LoopEvent>): AsyncIterable<string> {
  for await (const e of loop) yield sseEncode(e);
}
