import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  usePathname: () => '/net-worth',
  useRouter: () => ({ push: vi.fn() }),
}));

// AppHeader is a client component that reads next/navigation, so we render it
// to a static HTML string (react-dom/server) rather than pulling in jsdom /
// testing-library, which this project doesn't depend on — see
// MarkdownMessage.test.ts for the same pattern.
import AppHeader from '@/app/components/AppHeader';

describe('AppHeader', () => {
  it('offers Net worth in the nav and marks it current on its route', () => {
    const html = renderToStaticMarkup(createElement(AppHeader));
    const match = html.match(/<a [^>]*href="\/net-worth"[^>]*>Net worth<\/a>/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('aria-current="page"');
  });
});
