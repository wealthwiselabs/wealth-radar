import { describe, it, expect } from 'vitest';
import { clampPanelWidth } from '@/app/components/agent/panelWidth';

describe('clampPanelWidth', () => {
  it('floors at 340 and ceils at min(720, 60vw)', () => {
    expect(clampPanelWidth(100, 1920)).toBe(340);
    expect(clampPanelWidth(5000, 1920)).toBe(720);
    expect(clampPanelWidth(5000, 1000)).toBe(600);
    expect(clampPanelWidth(500, 1920)).toBe(500);
  });
});
