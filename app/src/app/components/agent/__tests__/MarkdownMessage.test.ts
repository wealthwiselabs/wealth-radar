import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownMessage from '../MarkdownMessage';

// Render the component to an HTML string. react-markdown renders synchronously,
// so renderToStaticMarkup lets us assert on real output in the node test env
// without pulling in jsdom / testing-library.
function render(text: string): string {
  return renderToStaticMarkup(createElement(MarkdownMessage, { text }));
}

describe('MarkdownMessage', () => {
  it('renders bold and italic emphasis', () => {
    const html = render('This is **bold** and *italic*.');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders lists', () => {
    const html = render('- one\n- two\n- three');
    expect(html).toContain('<ul');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>three</li>');
  });

  it('renders links safely with target and rel', () => {
    const html = render('See [Anthropic](https://example.com).');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('supports GFM tables and strikethrough', () => {
    const html = render('~~gone~~\n\n| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<table');
  });

  it('does NOT render raw HTML in the input (escaped, not injected)', () => {
    const html = render('Hi <script>alert("xss")</script> <img src=x onerror="alert(1)">');
    // The dangerous markup must be escaped to inert text, never emitted as live
    // elements. (The literal words "script"/"onerror" still appear — but only
    // inside the escaped &lt;…&gt; text, which is the point.)
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });
});
