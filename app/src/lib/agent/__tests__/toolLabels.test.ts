import { describe, it, expect } from 'vitest';
import { toolLabel } from '@/lib/agent/toolLabels';

describe('toolLabel', () => {
  it('maps known tools to friendly labels', () => {
    expect(toolLabel('search_transactions')).toBe('Searching your transactions');
    expect(toolLabel('web_search')).toBe('Searching the web');
    expect(toolLabel('deep_research')).toBe('Researching');
  });

  it('falls back to a de-underscored name for unknown tools', () => {
    expect(toolLabel('some_new_tool')).toBe('Using some new tool');
  });
});
