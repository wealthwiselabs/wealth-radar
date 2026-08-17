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
    topic: 'portfolio-allocation',
    description: 'General principles of asset allocation, diversification, and rebalancing.',
    body: read('portfolio-allocation.md'),
  },
];
