import { readFileSync } from 'fs';
import { join } from 'path';

// Runtime-read variant: this app is locally-hosted and run via `next start`
// from the project dir, so the `src/` tree (including these .md docs) is
// present on disk at runtime. Reading files directly avoids needing bundler
// config for markdown imports.
const dir = join(process.cwd(), 'src/lib/agent/knowledge');
function read(f: string) {
  return readFileSync(join(dir, f), 'utf8');
}

export interface KnowledgeDoc {
  topic: string;
  description: string;
  body: string;
}

export const KNOWLEDGE_MANIFEST: KnowledgeDoc[] = [
  {
    topic: 'financial-priorities',
    description: 'The order to put dollars to work: pay off high-interest debt, build an emergency fund, invest early, max tax-advantaged accounts, fund 529s, save for large purchases. Start here for "where should my money go?" questions.',
    body: read('financial-priorities.md'),
  },
  {
    topic: 'high-interest-debt',
    description: 'Why to avoid and pay off high-interest debt (credit cards, personal loans, ~10-20%+) before investing.',
    body: read('high-interest-debt.md'),
  },
  {
    topic: 'emergency-fund',
    description: 'Sizing (~6 months of expenses, adjusted for job security/risk) and where to hold an emergency fund (high-yield / money market).',
    body: read('emergency-fund.md'),
  },
  {
    topic: 'portfolio-allocation',
    description: 'Long-term investing: invest early, low-cost diversified ETFs/mutual funds, the 110-minus-age stock/bond rule, and rebalancing.',
    body: read('portfolio-allocation.md'),
  },
  {
    topic: 'tax-advantaged-accounts',
    description: 'Maximizing 401(k)/Roth IRA/HSA, order of operations, after-tax contributions, and backdoor/mega-backdoor Roth.',
    body: read('tax-advantaged-accounts.md'),
  },
  {
    topic: 'education-529',
    description: 'Saving for kids’ college with a separate 529 plan, started early.',
    body: read('education-529.md'),
  },
  {
    topic: 'large-purchase-savings',
    description: 'Parking money for a large near-term purchase (e.g. house down payment) conservatively in money market funds or CDs.',
    body: read('large-purchase-savings.md'),
  },
];
