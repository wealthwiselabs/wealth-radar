import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/db/client';
import { readTaxonomy, readRules } from '@/lib/storage';
import { resolveRule } from '@/lib/categoryRules';
import { formatTaxonomyForPrompt, formatRulesForPrompt } from '@/lib/classifyPrompt';

type Db = ReturnType<typeof getDb>;
export interface ClassifyInput {
  description: string;
  amount: number;
  plaidCategory?: string | null;
  /** 'credit' for cards, 'depository' for bank accounts. Decides whether a
   *  positive amount is a refund (card) or possibly real income (bank). */
  accountType?: string | null;
}
export interface ClassifyResult { categoryId: string; subcategoryId: string; }

export async function classifyTransactions(
  input: ClassifyInput[],
  opts: { apiKey?: string; db?: Db } = {},
): Promise<ClassifyResult[]> {
  const db = opts.db ?? getDb();
  const rules = await readRules(db);
  const results: ClassifyResult[] = input.map(() => ({ categoryId: '', subcategoryId: '' }));

  // 1) User-confirmed rules. Definitive on first use — no repeat-count threshold.
  const unresolved: number[] = [];
  input.forEach((t, i) => {
    const rule = resolveRule(t.description, rules);
    if (rule) {
      results[i] = { categoryId: rule.categoryId, subcategoryId: rule.subcategoryId };
    } else {
      unresolved.push(i);
    }
  });

  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (unresolved.length === 0 || !apiKey) return results;

  // 2) One Claude call for the remaining items.
  const taxonomy = await readTaxonomy();
  const client = new Anthropic({ apiKey });
  const system = `You classify bank transactions into a fixed taxonomy. Use ONLY these category and subcategory IDs.

TAXONOMY:
${formatTaxonomyForPrompt(taxonomy.categories)}
${formatRulesForPrompt(rules)}
Rules:
- Negative amounts are money out; positive amounts are money in. A positive amount is NOT automatically income — read the rules below.
- accountType "credit" is a credit card. A positive amount on a card is a REFUND for something bought on that card (a return, a price adjustment, a reversed charge). Classify it with the category of the thing that was returned — a clothing return is shopping > clothing, a returned e-book is entertainment. NEVER classify a positive amount on a card as income.
- Credit-card payments (e.g. "AUTOPAY PAYMENT - THANK YOU") → transfer > cc-payment, on either side.
- Moving money between the user's own accounts, including brokerage buys/sells and deposits into or out of investment accounts (e.g. "Vanguard Sell Investment") → transfer > investment or transfer > between-accounts. This is not income.
- Tax refunds from a government (e.g. "IRS TREAS 310 TAX REF") → taxes > income-tax-refund. Tax payments → taxes > income-tax-payment.
- A waived or reversed fee (e.g. "Monthly Maintenance Fee Waived") → financial > bank-fees. It is not income.
- income > refund is only for money arriving that never had a matching recorded expense (a rebate cheque, a settlement). Do not use it for returned purchases.
- Real income (salary, interest earned on a bank account) → income.
Return ONLY a JSON array. The plaidCategoryHint is advisory only — never output a category or subcategory ID that is not in the taxonomy above.`;

  const items = unresolved.map((i) => ({
    index: i, description: input[i].description, amount: input[i].amount,
    accountType: input[i].accountType ?? undefined,
    plaidCategoryHint: input[i].plaidCategory ?? undefined,
  }));
  const user = `Classify each transaction. Return ONLY a JSON array of {"index": number, "categoryId": string, "subcategoryId": string} — one per input item, using the item's "index".\n\n${JSON.stringify(items)}`;

  // Wrap the ENTIRE Claude interaction (network call, text extraction, parsing,
  // and result mapping) so ANY failure — a network/5xx/rate-limit error, an
  // unparseable body, etc. — leaves the still-unresolved items uncategorized
  // (pre-seeded above) rather than throwing and blocking ingest.
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 4096,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const json = text.startsWith('```') ? text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '') : text;

    const parsed = JSON.parse(json) as Array<{ index: number; categoryId: string; subcategoryId: string }>;
    for (const p of parsed) {
      if (typeof p.index === 'number' && results[p.index]) {
        results[p.index] = { categoryId: p.categoryId ?? '', subcategoryId: p.subcategoryId ?? '' };
      }
    }
  } catch {
    // Leave unresolved items uncategorized rather than throwing — never block ingest.
  }
  return results;
}
