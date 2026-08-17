import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import AppHeader from './components/AppHeader';
import ThemeSync from './components/ThemeSync';
import AgentWidget from './components/agent/AgentWidget';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

// Open fonts, self-hosted by next/font at build time (no external CDN):
// Inter for body/UI, Space Grotesk as the display face for headings + wordmark.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const display = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Wealthwise',
  description: 'Wealthwise — track spending and investments across your accounts',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The theme is inherently client-side — it depends on localStorage and on
    // the OS setting, neither of which the server can see — so the markup ships
    // with the light palette as a placeholder and the script below corrects it
    // before anything paints. suppressHydrationWarning is scoped to this one
    // element and is the point: data-theme is *expected* to differ from the
    // server's markup by the time React hydrates.
    <html
      lang="en"
      data-theme="light"
      className={`${inter.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Render-blocking on purpose: it must win the race against first
            paint, or a dark-theme user sees a light flash on every load. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <ThemeSync />
        <AppHeader />
        {children}
        <AgentWidget />
      </body>
    </html>
  );
}
