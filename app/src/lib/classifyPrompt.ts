import type { Category, CategoryRule } from '@/types';

export function formatTaxonomyForPrompt(categories: Category[]): string {
  return categories.map((cat) => {
    const subcats = cat.subcategories.map((sub) => {
      const examples = sub.examples.length > 0 ? `\n      Examples: ${sub.examples.join(', ')}` : '';
      return `    - ${sub.id}: "${sub.name}" - ${sub.description}${examples}`;
    }).join('\n');
    return `- ${cat.id}: "${cat.name}" - ${cat.description}\n${subcats}`;
  }).join('\n\n');
}

/**
 * Enabled rules already short-circuit before the API call; these are included
 * as examples of the user's own vocabulary so Claude classifies near-misses
 * (a new merchant at the same store, a variant description) consistently.
 */
export function formatRulesForPrompt(rules: CategoryRule[], limit = 50): string {
  const enabled = rules.filter((r) => r.enabled).slice(0, limit);
  if (enabled.length === 0) return '';
  const lines = enabled.map((r) => `- "${r.pattern}" → ${r.categoryId} > ${r.subcategoryId}`);
  return `\nUSER-CONFIRMED MERCHANT RULES (follow these conventions for similar merchants):\n${lines.join('\n')}\n`;
}
