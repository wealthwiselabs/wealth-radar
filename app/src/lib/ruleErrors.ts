/**
 * Typed errors for category-rule operations, kept in their own module so
 * both `storage.ts` and `ruleBackfill.ts` can throw them and the API routes
 * can `instanceof`-check them without any of the three depending on each
 * other's error-message text.
 */

export class PatternTooShortError extends Error {
  constructor() {
    super('Pattern must be at least 3 characters');
    this.name = 'PatternTooShortError';
  }
}

export class RuleNotFoundError extends Error {
  constructor(ruleId: string) {
    super(`Rule not found: ${ruleId}`);
    this.name = 'RuleNotFoundError';
  }
}

export class RuleDisabledError extends Error {
  constructor(ruleId: string) {
    super(`Rule is disabled: ${ruleId}`);
    this.name = 'RuleDisabledError';
  }
}

export class PatternConflictError extends Error {
  constructor(pattern: string) {
    super(`A rule for "${pattern}" already exists`);
    this.name = 'PatternConflictError';
  }
}
