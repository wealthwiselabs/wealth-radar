import { describe, it, expect } from 'vitest';
import { toAnthropicMessages } from '@/lib/agent/providers/anthropic';

describe('toAnthropicMessages image content', () => {
  it('emits array content with text + image blocks when a user turn has images', () => {
    const out = toAnthropicMessages([
      { role: 'user', text: 'what is this?', images: [{ mediaType: 'image/png', data: 'AAAA' }] },
    ]);
    expect(out).toHaveLength(1);
    const msg = out[0];
    expect(msg.role).toBe('user');
    expect(Array.isArray(msg.content)).toBe(true);
    const blocks = msg.content as any[];
    expect(blocks).toContainEqual({ type: 'text', text: 'what is this?' });
    expect(blocks).toContainEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
  });

  it('keeps string content for a plain user turn with no images', () => {
    const out = toAnthropicMessages([{ role: 'user', text: 'hello' }]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('hello');
  });
});
