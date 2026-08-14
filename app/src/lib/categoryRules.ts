import type { CategoryRule } from '@/types';

/** The only function permitted to produce a stored pattern. */
export function normalizePattern(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A pattern shorter than this would match most of the database. */
const MIN_PATTERN_LENGTH = 3;

export function isValidPattern(pattern: string): boolean {
  return normalizePattern(pattern).length >= MIN_PATTERN_LENGTH;
}

export function matchesPattern(description: string, pattern: string): boolean {
  const p = normalizePattern(pattern);
  if (!p) return false;
  return description.toLowerCase().includes(p);
}

/**
 * Most specific wins: the longest matching pattern, ties broken by the most
 * recently updated rule. Deriving precedence this way avoids a priority column
 * and the ordering UI that would come with it.
 */
export function resolveRule(description: string, rules: CategoryRule[]): CategoryRule | null {
  let best: CategoryRule | null = null;
  for (const r of rules) {
    if (!r.enabled) continue;
    if (!matchesPattern(description, r.pattern)) continue;
    if (
      best === null ||
      r.pattern.length > best.pattern.length ||
      (r.pattern.length === best.pattern.length && r.updatedAt > best.updatedAt)
    ) {
      best = r;
    }
  }
  return best;
}
