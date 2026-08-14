import type Anthropic from '@anthropic-ai/sdk';

/**
 * Shared statement-extraction prompt + call. Used by the batch CLI
 * (scripts/import-statements.ts) and the single-statement preview API route so
 * both parse with identical instructions.
 */
export const EXTRACT_SYSTEM = `You extract structured data from an investment statement, which MAY contain MULTIPLE accounts (a combined household report). Return ONLY a JSON array — one object per account:
[{"institution": string, "accountMask": string (last 4 digits of the account number) or null if none is shown, "planName": string or null (for an employer 401k/retirement plan, the employer/plan short name e.g. "Roblox", "Acme", "Ironclad"; null for brokerage/IRA/Roth), "asOf": "YYYY-MM-DD" (period-end), "reportedTotal": number (that account's ending value), "holdings": [{"ticker": string|null, "name": string, "quantity": number|null, "value": number}], "transactions": [{"date":"YYYY-MM-DD","subtype": one of contribution|deposit|withdrawal|distribution|buy|sell|dividend|interest|fee|other,"amount": number, POSITIVE into the account, NEGATIVE out}], "activity": [{"date":"YYYY-MM-DD","ticker": string|null,"name": string (the security name),"type": one of buy|sell|reinvest|dividend|other,"amount": number, POSITIVE for a purchase/into the position, NEGATIVE for a sale/out}]}]
For a 401k statement, take contributions from the "Contribution Summary" (employee deferral + employer). "transactions" = ONLY real external cash movements (not buys/sells/dividends/exchanges). "activity" = EVERY line in the account-activity / transaction-detail section: each buy, sell, reinvestment, and dividend for a specific fund, with its ticker (if shown), security name, type, and dollar amount. Label reinvested dividends as type "reinvest". Do not invent values; omit "activity" (or use []) if the statement has no activity section.`;

/** Run Claude extraction over statement text; returns the raw parsed JSON value. */
export async function extractStatement(client: Anthropic, text: string): Promise<unknown> {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 4096,
    system: [{ type: 'text', text: EXTRACT_SYSTEM }],
    messages: [{ role: 'user', content: text.slice(0, 100_000) }],
  });
  const raw = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim();
  const json = raw.startsWith('```') ? raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '') : raw;
  return JSON.parse(json);
}
