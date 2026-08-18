import { describe, it, expect } from 'vitest';
import { formatViewContext, type ViewSnapshot } from '@/app/lib/viewContext';

describe('formatViewContext', () => {
  it('returns empty string for null', () => {
    expect(formatViewContext(null)).toBe('');
  });
  it('names the view and caps highlights at 8 and table rows at 15', () => {
    const snap: ViewSnapshot = {
      route: '/', label: 'Home',
      highlights: Array.from({ length: 10 }, (_, i) => ({ label: `h${i}`, value: `${i}` })),
      tables: [{ title: 'T', columns: ['a', 'b'], rows: Array.from({ length: 20 }, (_, i) => [`${i}`, `${i}`]) }],
    };
    const out = formatViewContext(snap);
    expect(out).toContain('Home');
    expect(out).toContain('/');
    expect((out.match(/- h\d/g) || []).length).toBe(8);      // highlights capped
    // table rows capped: row "15 | 15" and beyond must not appear
    expect(out).toContain('0 | 0');
    expect(out).not.toContain('15 | 15');
  });
});
