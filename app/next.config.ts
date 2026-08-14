import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable server-side external packages for pdf.js worker, and for
  // better-sqlite3: the autoSync import chain reachable from
  // instrumentation.ts (Task 3) otherwise pulls it into a bundling context
  // that can't resolve Node's 'fs'/'path'/'crypto' builtins.
  serverExternalPackages: ['pdfjs-dist', 'better-sqlite3'],
  // Defaults to the normal .next/ build dir. The e2e harness overrides this
  // (see playwright.config.ts) so its throwaway `next dev` server never
  // shares .next/ with the developer's own long-running `next dev` on
  // port 3000 — see the comment there for why that matters.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;
