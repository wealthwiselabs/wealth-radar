// Confirmation-gated write tools. Each wraps an existing domain function and
// does NOT touch the DB directly (no raw SQL): the domain layer owns the
// snapshot / aggregate-recompute invariants. A gated tool's `run` only ever
// executes through the route's explicit approve path (see chat/route.ts), never
// from the loop itself.
import { updateTransaction, createRule, deduplicateTransactions, findTransactionById, readTaxonomy, addTransactions } from '@/lib/storage';
import { applyRule, previewRule } from '@/lib/ruleBackfill';
import { mergeAccounts } from '@/lib/accountMerge';
import { snapshotDb } from '@/lib/backup';
import { PatternTooShortError } from '@/lib/ruleErrors';
import { getStagedStatement, clearStagedStatement } from '@/lib/agent/staging';
import type { Tool } from './types';

// Validate category/subcategory ids against the taxonomy so the model can't
// write invented ids (e.g. "personal_care"/"fitness" when the real ids are
// "personal-care"/"gym") that the UI can neither render nor filter. Returns
// null when valid, else a message listing the valid ids so the model can
// self-correct rather than silently corrupting a row.
async function validateCategory(categoryId?: string, subcategoryId?: string): Promise<string | null> {
  if (!categoryId && !subcategoryId) return null;
  const taxonomy = await readTaxonomy();
  if (!categoryId) {
    return `A categoryId is required when setting a subcategory ("${subcategoryId}").`;
  }
  const category = taxonomy.categories.find((c) => c.id === categoryId);
  if (!category) {
    return `Unknown category "${categoryId}". Valid categories: ${taxonomy.categories.map((c) => c.id).join(', ')}.`;
  }
  if (subcategoryId && !category.subcategories.some((s) => s.id === subcategoryId)) {
    return `Unknown subcategory "${subcategoryId}" for ${categoryId}. Valid: ${category.subcategories.map((s) => s.id).join(', ')}.`;
  }
  return null;
}

export const editTransactionMetadataTool: Tool = {
  gate: 'apply-undo',
  spec: {
    name: 'edit_transaction_metadata',
    description: 'Change the category, subcategory, or note of a single transaction by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        categoryId: { type: 'string' },
        subcategoryId: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  async preview(input: { id: string; categoryId?: string; subcategoryId?: string; note?: string }, { db }) {
    const tx = await findTransactionById(input.id, db);
    if (!tx) {
      return {
        title: 'Recategorize transaction?',
        diff: { summary: `Transaction ${input.id} not found` },
        confirmLabel: 'Apply',
      };
    }

    let summary: string;
    if (input.categoryId || input.subcategoryId) {
      const taxonomy = await readTaxonomy();
      const category = taxonomy.categories.find((c) => c.id === input.categoryId);
      const subcategory = category?.subcategories.find((s) => s.id === input.subcategoryId)
        ?? taxonomy.categories
          .flatMap((c) => c.subcategories)
          .find((s) => s.id === input.subcategoryId);
      const categoryName = category?.name ?? input.categoryId;
      const subcategoryName = subcategory?.name ?? input.subcategoryId;
      const target = [categoryName, subcategoryName].filter(Boolean).join(' / ');
      summary = `"${tx.description}" → ${target}`;
    } else {
      summary = `"${tx.description}" note → "${input.note ?? ''}"`;
    }

    return {
      title: 'Recategorize transaction?',
      diff: { summary },
      confirmLabel: 'Apply',
    };
  },
  // updateTransaction already defaults omitted fields to the existing values and
  // recomputes monthly aggregates internally, so we neither read a `before` nor
  // recompute here. categorySource is only forced to 'manual' when a category is
  // actually being changed — a note-only edit must not make the row rule-immune.
  async run(input: { id: string; categoryId?: string; subcategoryId?: string; note?: string }, { db }) {
    const invalid = await validateCategory(input.categoryId, input.subcategoryId);
    if (invalid) return { content: invalid, isError: true };
    const updated = await updateTransaction(
      input.id,
      {
        categoryId: input.categoryId,
        subcategoryId: input.subcategoryId,
        note: input.note,
        categorySource: (input.categoryId || input.subcategoryId) ? 'manual' : undefined,
      },
      db,
    );
    if (!updated) return { content: `No transaction ${input.id}`, isError: true };
    return { content: `Updated ${input.id}: ${updated.categoryId}/${updated.subcategoryId}` };
  },
};

export const updateMatchingRuleTool: Tool = {
  gate: 'confirm',
  spec: {
    name: 'update_matching_rule',
    description:
      'Create or update a category rule for a description pattern; applies to matching past and future transactions.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        categoryId: { type: 'string' },
        subcategoryId: { type: 'string' },
      },
      required: ['pattern', 'categoryId', 'subcategoryId'],
      additionalProperties: false,
    },
  },
  async preview(input: { pattern: string; categoryId: string; subcategoryId: string }, { db }) {
    const invalid = await validateCategory(input.categoryId, input.subcategoryId);
    if (invalid) {
      return { title: 'Create/Update matching rule?', diff: { summary: invalid }, confirmLabel: 'Apply rule' };
    }
    const p = previewRule(
      { pattern: input.pattern, categoryId: input.categoryId, subcategoryId: input.subcategoryId },
      db,
    );
    return {
      title: 'Create/Update matching rule?',
      diff: {
        summary: `"${input.pattern}" → ${input.categoryId}/${input.subcategoryId}; ${p.willChange} transaction(s) will change`,
        affected: p.willChange,
      },
      confirmLabel: 'Apply rule',
    };
  },
  async run(input: { pattern: string; categoryId: string; subcategoryId: string }, { db }) {
    const invalid = await validateCategory(input.categoryId, input.subcategoryId);
    if (invalid) return { content: invalid, isError: true };
    snapshotDb('pre-agent-rule', { db });
    let rule;
    try {
      rule = await createRule(
        { pattern: input.pattern, categoryId: input.categoryId, subcategoryId: input.subcategoryId },
        db,
      );
    } catch (err) {
      if (err instanceof PatternTooShortError) {
        return { content: err.message, isError: true };
      }
      throw err;
    }
    const res = applyRule(rule.id, db);
    return { content: `Rule saved for "${input.pattern}"; ${res.changed} transaction(s) recategorized.` };
  },
};

export const reconcileTransactionsTool: Tool = {
  gate: 'confirm',
  spec: {
    name: 'reconcile_transactions',
    description: 'Run duplicate detection/reconciliation across sources.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async preview() {
    return {
      title: 'Reconcile transactions?',
      diff: { summary: 'Detect and collapse cross-source duplicate transactions.' },
      confirmLabel: 'Reconcile',
    };
  },
  async run(_input, { db }) {
    snapshotDb('pre-agent-reconcile', { db });
    const r = await deduplicateTransactions(db);
    return { content: `Reconciled: kept ${r.kept}, removed ${r.removed}.` };
  },
};

export const mergeAccountsTool: Tool = {
  gate: 'confirm',
  spec: {
    name: 'merge_accounts',
    description: 'Merge one or more source accounts into a target account.',
    inputSchema: {
      type: 'object',
      properties: {
        targetId: { type: 'string' },
        sourceIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['targetId', 'sourceIds'],
      additionalProperties: false,
    },
  },
  async preview(input: { targetId: string; sourceIds: string[] }) {
    return {
      title: 'Merge accounts?',
      diff: {
        summary: `Merge ${input.sourceIds.join(', ')} → ${input.targetId}. This is hard to undo.`,
        affected: input.sourceIds.length,
      },
      confirmLabel: 'Merge accounts',
    };
  },
  async run(input: { targetId: string; sourceIds: string[] }, { db }) {
    snapshotDb('pre-agent-merge', { db });
    mergeAccounts(input.targetId, input.sourceIds, db);
    return { content: `Merged ${input.sourceIds.length} account(s) into ${input.targetId}.` };
  },
};

export const importStatementTool: Tool = {
  gate: 'apply-undo',
  spec: {
    name: 'import_statement',
    description: 'Import the currently staged (classified) statement into the transaction ledger.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  async preview(_input, ctx) {
    const staged = getStagedStatement(ctx.conversationId ?? '');
    if (!staged) {
      return {
        title: 'Import statement?',
        diff: { summary: 'No statement is staged to import.' },
        confirmLabel: 'Import',
      };
    }
    const n = staged.transactions.length;
    const dates = staged.transactions.map((t) => t.date).sort();
    const range = dates.length ? `${dates[0]} – ${dates[dates.length - 1]}` : 'no dates';
    const gross = staged.transactions.reduce((sum, t) => sum + t.amount, 0);
    const summary = `${n} transaction(s) from "${staged.fileName}", ${range}, gross total ${gross.toFixed(2)}`;
    return {
      title: 'Import statement?',
      diff: { summary },
      confirmLabel: `Import ${n} transactions`,
    };
  },
  async run(_input, ctx) {
    const staged = getStagedStatement(ctx.conversationId ?? '');
    if (!staged) return { content: 'Nothing staged to import.' };
    snapshotDb('pre-agent-import', { db: ctx.db });
    const res = await addTransactions(staged.transactions, ctx.db);
    clearStagedStatement(ctx.conversationId!);
    const count = res?.added?.length ?? staged.transactions.length;
    return { content: `Imported ${count} transaction(s) from ${staged.fileName}.` };
  },
};

export const writeTools: Tool[] = [
  editTransactionMetadataTool,
  updateMatchingRuleTool,
  reconcileTransactionsTool,
  mergeAccountsTool,
  importStatementTool,
];

export const writeToolsByName = new Map(writeTools.map((t) => [t.spec.name, t]));
