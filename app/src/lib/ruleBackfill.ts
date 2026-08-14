import { eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { matchesPattern, normalizePattern } from '@/lib/categoryRules';
import { recomputeMonthlyAggregates } from '@/lib/aggregates';
import { RuleDisabledError, RuleNotFoundError } from '@/lib/ruleErrors';

type Db = ReturnType<typeof getDb>;

/** A rule matching more of the database than this is probably a payment prefix. */
const HIGH_MATCH_RATE = 0.10;
/** Matches spanning more categories than this are probably several merchants. */
const MANY_CATEGORIES = 5;
const MAX_SAMPLES = 10;

export interface RuleImpactSample {
  id: string; date: string; description: string; amount: number;
  categoryId: string; subcategoryId: string;
}

export interface RulePreview {
  pattern: string;
  totalMatches: number;
  alreadyCorrect: number;
  willChange: number;
  skippedManual: number;
  distinctCategories: number;
  warnHighMatchRate: boolean;
  warnManyCategories: boolean;
  samples: RuleImpactSample[];
}

/**
 * Filtering happens in JS rather than via SQL LIKE so that preview, apply, and
 * ingest-time resolution can never disagree about what a pattern matches.
 */
export function previewRule(
  input: { pattern: string; categoryId: string; subcategoryId: string },
  db: Db = getDb(),
): RulePreview {
  const pattern = normalizePattern(input.pattern);
  const all = db.select().from(schema.transactions)
    .where(isNull(schema.transactions.supersededBy)).all();

  const matches = all.filter((t) => matchesPattern(t.description, pattern));

  let alreadyCorrect = 0, willChange = 0, skippedManual = 0;
  const categories = new Set<string>();
  const samples: RuleImpactSample[] = [];

  for (const t of matches) {
    categories.add(t.categoryId);
    if (t.categorySource === 'manual') { skippedManual += 1; continue; }
    if (t.categoryId === input.categoryId && t.subcategoryId === input.subcategoryId) {
      alreadyCorrect += 1;
      continue;
    }
    willChange += 1;
    if (samples.length < MAX_SAMPLES) {
      samples.push({
        id: t.id, date: t.date, description: t.description, amount: t.amount,
        categoryId: t.categoryId, subcategoryId: t.subcategoryId,
      });
    }
  }

  return {
    pattern,
    totalMatches: matches.length,
    alreadyCorrect, willChange, skippedManual,
    distinctCategories: categories.size,
    warnHighMatchRate: all.length > 0 && matches.length / all.length > HIGH_MATCH_RATE,
    warnManyCategories: categories.size > MANY_CATEGORIES,
    samples,
  };
}

/**
 * Rewrites every non-manual matching row, then recomputes aggregates once per
 * affected (account, month) pair — not once per row, which is what routing
 * through updateTransaction would do. The whole run is one SQLite transaction,
 * so a failure mid-way leaves no partially rewritten category set.
 */
export function applyRule(
  ruleId: string,
  db: Db = getDb(),
): { changed: number; skippedManual: number } {
  const rule = db.select().from(schema.categoryRules)
    .where(eq(schema.categoryRules.id, ruleId)).get();
  if (!rule) throw new RuleNotFoundError(ruleId);
  if (!rule.enabled) throw new RuleDisabledError(ruleId);

  return db.transaction((tx) => {
    const all = tx.select().from(schema.transactions)
      .where(isNull(schema.transactions.supersededBy)).all();

    const now = new Date().toISOString();
    const affected = new Set<string>();
    let changed = 0, skippedManual = 0;

    for (const t of all) {
      if (!matchesPattern(t.description, rule.pattern)) continue;
      if (t.categorySource === 'manual') { skippedManual += 1; continue; }
      if (t.categoryId === rule.categoryId && t.subcategoryId === rule.subcategoryId) continue;

      tx.update(schema.transactions).set({
        categoryId: rule.categoryId,
        subcategoryId: rule.subcategoryId,
        categorySource: 'rule',
        modifiedAt: now,
      }).where(eq(schema.transactions.id, t.id)).run();

      affected.add(`${t.accountId}|${t.month}`);
      changed += 1;
    }

    for (const key of affected) {
      const [accountId, month] = key.split('|');
      recomputeMonthlyAggregates(accountId, month, tx as unknown as Db);
    }

    return { changed, skippedManual };
  });
}
