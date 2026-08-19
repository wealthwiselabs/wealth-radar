import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatViewContext, getViewContext, setViewBase, setViewSection, removeViewSection,
  type ViewSnapshot,
} from '@/app/lib/viewContext';

const base = { route: '/investments', label: 'Investments', highlights: [{ label: 'Portfolio', value: '$1' }] };

describe('view-context registry', () => {
  beforeEach(() => setViewBase(null));

  it('returns null with no base', () => {
    expect(getViewContext()).toBeNull();
  });

  it('merges base with registered sections, ordered by order then id', () => {
    setViewBase(base);
    setViewSection({ id: 'b', order: 2, title: 'B', summary: 'b' });
    setViewSection({ id: 'a', order: 1, title: 'A', summary: 'a' });
    const snap = getViewContext()!;
    expect(snap.route).toBe('/investments');
    expect(snap.sections!.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('removes a section on removeViewSection', () => {
    setViewBase(base);
    setViewSection({ id: 'a', title: 'A', summary: 'a' });
    removeViewSection('a');
    expect(getViewContext()!.sections).toEqual([]);
  });

  it('clears sections when the route changes', () => {
    setViewBase(base);
    setViewSection({ id: 'a', title: 'A', summary: 'a' });
    setViewBase({ route: '/', label: 'Home', highlights: [] });
    expect(getViewContext()!.sections).toEqual([]);
  });

  it('keeps sections when the same route re-publishes its base', () => {
    setViewBase(base);
    setViewSection({ id: 'a', title: 'A', summary: 'a' });
    setViewBase({ ...base, timeRange: 'YTD' });
    expect(getViewContext()!.sections!.map((s) => s.id)).toEqual(['a']);
  });
});

describe('formatViewContext', () => {
  it('returns empty string for null', () => {
    expect(formatViewContext(null)).toBe('');
  });

  it('names the view and caps highlights at 8', () => {
    const snap: ViewSnapshot = {
      route: '/', label: 'Home',
      highlights: Array.from({ length: 10 }, (_, i) => ({ label: `h${i}`, value: `${i}` })),
    };
    const out = formatViewContext(snap);
    expect(out).toContain('Home');
    expect((out.match(/- h\d/g) || []).length).toBe(8);
  });

  it('renders sections with a detail hint including args', () => {
    const snap: ViewSnapshot = {
      route: '/investments', label: 'Investments', highlights: [],
      sections: [{
        id: 'investments.holdings', title: 'Holdings breakdown', summary: '3 accounts, $412k',
        detail: { tool: 'get_holdings_breakdown', args: { account: 'all' } },
      }],
    };
    const out = formatViewContext(snap);
    expect(out).toContain('Sections on screen');
    expect(out).toContain('- Holdings breakdown: 3 accounts, $412k [details: get_holdings_breakdown {"account":"all"}]');
  });

  it('renders a summary-only section without a hint, and omits empty args', () => {
    const snap: ViewSnapshot = {
      route: '/', label: 'Home', highlights: [],
      sections: [
        { id: 'x', title: 'X', summary: 'plain' },
        { id: 'y', title: 'Y', summary: 'y', detail: { tool: 'query_spending' } },
      ],
    };
    const out = formatViewContext(snap);
    expect(out).toContain('- X: plain');
    expect(out).not.toContain('[details:'.concat(' ]'));
    expect(out).toContain('- Y: y [details: query_spending]');
  });
});
