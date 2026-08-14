import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import AppHeader from './components/AppHeader';

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
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body className="min-h-screen">
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
