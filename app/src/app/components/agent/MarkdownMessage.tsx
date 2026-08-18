import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

// Renders an assistant message as markdown. GitHub-flavored (lists, tables,
// strikethrough, autolinks) via remark-gfm. Raw HTML is intentionally NOT
// enabled (no rehype-raw): model output is untrusted, and react-markdown
// escapes HTML by default — keep it that way. Links open in a new tab with
// rel="noopener noreferrer". Element styling lives in the `.chat-markdown`
// block in globals.css so it stays theme-aware and out of the render path.
const components: Components = {
  a: ({ href, children, ...props }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  ),
  // Wide tables scroll inside the bubble rather than blowing out its width.
  table: ({ children, ...props }) => (
    <div className="chat-markdown-table">
      <table {...props}>{children}</table>
    </div>
  ),
};

export default function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
