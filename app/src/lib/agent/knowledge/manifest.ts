import { readFileSync } from 'fs';
import { join } from 'path';

// Runtime-read variant: this app is locally-hosted and run via `next start`
// from the project dir, so the `src/` tree (including these .md docs) is
// present on disk at runtime (the Docker image copies this dir explicitly).
// Reading files directly avoids needing bundler config for markdown imports.
const dir = join(process.cwd(), 'src/lib/agent/knowledge');

// Read a knowledge doc, tolerating a missing/unreadable file. This module is
// imported by the chat route, so a throw HERE would 500 the entire assistant —
// which is exactly the outage a mispackaged image caused once. Returning null
// lets the caller drop just that one topic, degrading the assistant by a single
// doc instead of taking the whole route down. The failure is logged, not
// swallowed, so a packaging slip is visible.
function read(f: string): string | null {
  try {
    return readFileSync(join(dir, f), 'utf8');
  } catch (err) {
    console.warn(
      `[knowledge] could not load '${f}' — topic will be unavailable:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export interface KnowledgeDoc {
  topic: string;
  description: string;
  body: string;
}

// Topic → file + description, kept as data so the loader below can build the
// manifest defensively. A doc whose file fails to load is omitted from
// KNOWLEDGE_MANIFEST (see `read`), so the load_knowledge tool never offers a
// topic it can't actually serve.
const SOURCES: { topic: string; description: string; file: string }[] = [
  {
    topic: 'financial-priorities',
    description: 'The order to put dollars to work: pay off high-interest debt, build an emergency fund, invest early, max tax-advantaged accounts, fund 529s, save for large purchases. Start here for "where should my money go?" questions.',
    file: 'financial-priorities.md',
  },
  {
    topic: 'high-interest-debt',
    description: 'Why to avoid and pay off high-interest debt (credit cards, personal loans, ~10-20%+) before investing.',
    file: 'high-interest-debt.md',
  },
  {
    topic: 'emergency-fund',
    description: 'Sizing (~6 months of expenses, adjusted for job security/risk) and where to hold an emergency fund (high-yield / money market).',
    file: 'emergency-fund.md',
  },
  {
    topic: 'portfolio-allocation',
    description: 'Long-term investing: invest early, low-cost diversified ETFs/mutual funds, the 110-minus-age stock/bond rule, and rebalancing.',
    file: 'portfolio-allocation.md',
  },
  {
    topic: 'tax-advantaged-accounts',
    description: 'Maximizing 401(k)/Roth IRA/HSA, order of operations, after-tax contributions, and backdoor/mega-backdoor Roth.',
    file: 'tax-advantaged-accounts.md',
  },
  {
    topic: 'speculative-products',
    description: 'Why to avoid options and similar high-risk, zero-sum instruments unless you are an expert, and keep speculation out of the core portfolio.',
    file: 'speculative-products.md',
  },
  {
    topic: 'insurance',
    description: 'Insurance as protection not investment: avoid IUL/VUL as investments (prefer term life + taxable investing), the narrow exception, and covering disability insurance for breadwinners.',
    file: 'insurance.md',
  },
  {
    topic: 'education-529',
    description: 'Saving for kids’ college with a separate 529 plan, started early.',
    file: 'education-529.md',
  },
  {
    topic: 'large-purchase-savings',
    description: 'Parking money for a large near-term purchase (e.g. house down payment) conservatively in money market funds or CDs.',
    file: 'large-purchase-savings.md',
  },
];

export const KNOWLEDGE_MANIFEST: KnowledgeDoc[] = SOURCES.flatMap((s) => {
  const body = read(s.file);
  return body === null ? [] : [{ topic: s.topic, description: s.description, body }];
});
