import Anthropic from '@anthropic-ai/sdk';
import { normalizePattern, isValidPattern } from '@/lib/categoryRules';

/** Payment processors that prefix the real merchant name. */
const PROCESSOR_PREFIX = /^(aplpay|tst\*|sq \*|paypal \*|dd \*)\s*/i;

/**
 * Free, instant seed. Good enough for "Kindle Svcs" and "COSTCO GAS"; the
 * model does better on messy descriptions, and the field is editable anyway.
 */
export function heuristicPattern(description: string): string {
  let s = description.trim();
  s = s.replace(PROCESSOR_PREFIX, '');
  s = s.split('*')[0];                    // drop an order-id suffix
  s = s.replace(/\s+#?\d{3,}.*$/, '');    // drop store numbers and everything after
  s = s.replace(/\s+[A-Z]{2}$/, '');      // drop a trailing state abbreviation
  return normalizePattern(s);
}

const SYSTEM = `You extract merchant match patterns from raw bank transaction descriptions.

Return the SHORTEST substring of the description that identifies the merchant, and nothing else — no quotes, no explanation.

Rules:
- Strip payment-processor prefixes: AplPay, TST*, SQ *, PAYPAL *, DD *. The merchant is what follows.
- Strip order IDs (text after *), store numbers, city, state, phone numbers, and URLs appended by the processor.
- PRESERVE distinctions that mean different categories: "COSTCO GAS" and "COSTCO WHSE" are different merchants, so do not shorten either to "COSTCO".
- Your answer must appear verbatim (case-insensitively) inside the input description.`;

export async function suggestPattern(
  description: string,
  opts: { apiKey?: string } = {},
): Promise<string> {
  const fallback = heuristicPattern(description);
  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) return fallback;

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 64,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: description }],
    });
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const candidate = normalizePattern(text);

    // A pattern that does not occur in the description would match nothing.
    if (!isValidPattern(candidate)) return fallback;
    if (!description.toLowerCase().includes(candidate)) return fallback;
    return candidate;
  } catch {
    return fallback;
  }
}
