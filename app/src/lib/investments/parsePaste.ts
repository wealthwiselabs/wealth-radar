import Anthropic from '@anthropic-ai/sdk';
import type { ParsedHolding } from '@/lib/investments/snapshots';

export interface ParseResult {
  holdings: ParsedHolding[];
  detectedTotal: number | null;
  error?: string;
}

/** Narrow shape so tests can pass a stub instead of a real SDK client. */
export interface AnthropicLike {
  messages: {
    create: (args: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

const EMPTY: ParseResult = { holdings: [], detectedTotal: null };

const SYSTEM = `You extract investment holdings from text a user copied out of a brokerage or 401k website.

Return ONLY a JSON object of the shape:
{"holdings":[{"ticker":string|null,"name":string,"quantity":number|null,"value":number}],"detectedTotal":number|null}

Rules:
- "value" is the current market value of the position in US dollars. Strip currency symbols, commas, and parentheses.
- A value in parentheses or with a leading minus is negative.
- "quantity" is the share or unit count. Use null when the page shows no share count — never guess one.
- "ticker" is the exchange symbol when present. Many 401k plans hold collective trusts and stable value funds with no ticker; use null for those and rely on the name.
- Do not include the account total, subtotals, "Total", or cash-sweep summary lines in "holdings". If you can identify an account total, put it in "detectedTotal", otherwise null.
- Do not invent positions that are not in the text. An empty holdings array is a valid answer.`;

export function extractJson(text: string): string {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  return t.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    // Number('') is 0, not NaN — an absent value must not become a $0 position.
    if (!cleaned) return null;
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Defensively narrow whatever the model returned. Anything unusable is dropped
 * rather than coerced into a plausible-looking number — a fabricated position
 * would flow straight into a snapshot the user cannot later verify.
 */
export function coerceParseResult(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.holdings)) return { ...EMPTY, detectedTotal: num(obj.detectedTotal) };

  const holdings: ParsedHolding[] = [];
  for (const item of obj.holdings) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const value = num(row.value);
    if (value === null) continue;

    const ticker = typeof row.ticker === 'string' && row.ticker.trim() ? row.ticker.trim() : null;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!ticker && !name) continue;

    holdings.push({ ticker, name: name || ticker!, quantity: num(row.quantity), value });
  }
  return { holdings, detectedTotal: num(obj.detectedTotal) };
}

/**
 * Turn a pasted holdings table into structured rows.
 *
 * Never throws: a parse failure returns an empty result carrying `error`, so
 * the caller can preserve the user's raw text for editing rather than losing
 * it. This function performs no writes.
 */
export async function parseHoldingsPaste(
  text: string,
  opts: { apiKey?: string; client?: AnthropicLike } = {},
): Promise<ParseResult> {
  if (!text.trim()) return { ...EMPTY };

  const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!opts.client && !apiKey) {
    return { ...EMPTY, error: 'No Anthropic API key configured. Add one in Settings.' };
  }

  try {
    const client: AnthropicLike = opts.client ?? (new Anthropic({ apiKey }) as unknown as AnthropicLike);

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Extract the holdings from this text:\n\n${text}` }],
    });

    const reply = msg.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    const parsed = JSON.parse(extractJson(reply)) as unknown;
    return coerceParseResult(parsed);
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : 'Could not parse the pasted text.' };
  }
}
