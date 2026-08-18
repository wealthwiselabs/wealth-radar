import { describe, it, expect } from 'vitest';
import { formatThoughtDuration } from '@/lib/agent/thinking';

describe('formatThoughtDuration', () => {
  it('floors to whole seconds, minimum 1s', () => {
    expect(formatThoughtDuration(0)).toBe('1s');
    expect(formatThoughtDuration(1400)).toBe('1s');
    expect(formatThoughtDuration(12800)).toBe('12s');
    expect(formatThoughtDuration(60000)).toBe('60s');
  });
});
