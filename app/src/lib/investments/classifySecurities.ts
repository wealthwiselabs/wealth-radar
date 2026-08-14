import type { AssetType } from '@/lib/investments/securities';
import Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { ASSET_TYPES, REGIONS, CAPS, STYLES, SECTORS, KINDS } from '@/lib/investments/tagVocab';

// Re-export the shared vocabulary so existing importers (and tests) keep working.
export { ASSET_TYPES, REGIONS, CAPS, STYLES, SECTORS, KINDS };

export type TagValues = Omit<SecurityTag, 'id'>;

/**
 * Validate/normalize a manual tag correction into the same vocabulary the AI
 * classifier uses. Returns null (reject) when assetType is unknown/absent. On a
 * non-equity type the finer dims are forced null; on equity, out-of-vocab finer
 * dims are coerced to null. The caller supplies the security id separately.
 */
export function coerceTagPatch(input: unknown): TagValues | null {
  const r = (input ?? {}) as Record<string, unknown>;
  const assetType = oneOf(r.assetType, ASSET_TYPES as unknown as string[]) as AssetType | null;
  if (!assetType) return null;
  if (assetType !== 'equity') return { assetType, region: null, cap: null, style: null, sector: null };
  return {
    assetType,
    region: oneOf(r.region, REGIONS),
    cap: oneOf(r.cap, CAPS),
    style: oneOf(r.style, STYLES),
    sector: oneOf(r.sector, SECTORS),
  };
}

/** null unless `input.kind` is a recognized security kind. */
export function coerceKind(input: unknown): string | null {
  const r = (input ?? {}) as Record<string, unknown>;
  return oneOf(r.kind, KINDS);
}

type Db = ReturnType<typeof getDb>;

export interface SecurityTag {
  id: string;
  assetType: AssetType;
  region: string | null;
  cap: string | null;
  style: string | null;
  sector: string | null;
}

/** null unless `v` is one of `allowed`. */
function oneOf(v: unknown, allowed: string[]): string | null {
  return typeof v === 'string' && allowed.includes(v) ? v : null;
}

/**
 * Parse Claude's JSON response into coerced SecurityTags. Untrusted input:
 * an out-of-vocabulary assetType becomes 'other', out-of-vocabulary finer
 * dims become null, and a non-equity assetType forces every finer dim to null
 * (they are meaningless off the equity branch of bucketPath). Rows without a
 * string id are dropped; unparseable text yields [].
 */
export function parseSecurityTags(text: string): SecurityTag[] {
  const body = text.trim().startsWith('```')
    ? text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    : text;
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const out: SecurityTag[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r.id !== 'string') continue;
    const assetType = (oneOf(r.assetType, ASSET_TYPES as unknown as string[]) ?? 'other') as AssetType;
    if (assetType === 'equity') {
      out.push({
        id: r.id,
        assetType,
        region: oneOf(r.region, REGIONS),
        cap: oneOf(r.cap, CAPS),
        style: oneOf(r.style, STYLES),
        sector: oneOf(r.sector, SECTORS),
      });
    } else {
      out.push({ id: r.id, assetType, region: null, cap: null, style: null, sector: null });
    }
  }
  return out;
}

/**
 * Apply a manual tag correction to one security, writing tag_source='user' —
 * the top of the precedence ladder, so classifyUntaggedSecurities (which only
 * selects 'plaid'/'seed') never overwrites it. Returns a discriminated result
 * so the route can map invalid→400, missing→404, ok→200.
 */
export function applyTagCorrection(
  db: Db, id: string, input: unknown,
): { ok: true } | { ok: false; reason: 'invalid' | 'not_found' } {
  const tag = coerceTagPatch(input);
  if (!tag) return { ok: false, reason: 'invalid' };
  const kind = coerceKind(input);
  const now = new Date().toISOString();
  const r = db.update(schema.securities)
    .set({
      assetType: tag.assetType, region: tag.region, cap: tag.cap, style: tag.style, sector: tag.sector,
      ...(kind ? { kind } : {}),
      tagSource: 'user', modifiedAt: now,
    })
    .where(eq(schema.securities.id, id))
    .run();
  return r.changes > 0 ? { ok: true } : { ok: false, reason: 'not_found' };
}

export type SecurityToClassify = { id: string; ticker: string | null; name: string; kind: string };
export type ClassifyFn = (securities: SecurityToClassify[]) => Promise<SecurityTag[]>;

const SYSTEM = `You classify investment securities (ETFs, mutual funds, stocks, money-market and cash) into a fixed allocation taxonomy. For each input security, return its asset class and — only when it is an equity — its US/international region, market cap, style, or sector.

Use ONLY these values (any other value will be discarded):
- assetType: equity | bond | money_market | cash | insurance | other
- region (equity only): us | intl_developed | intl_emerging | global
- cap (equity only): large | mid | small
- style (equity only): value | growth | blend
- sector (equity only, for a sector fund): technology | real_estate

Rules:
- A bond fund (e.g. "PIMCO Total Return", "Vanguard Total Bond", "Fidelity US Bond Index") is assetType "bond", NOT equity — even though its wrapper is a mutual fund/ETF.
- A money-market fund (e.g. "Fidelity Government Money Market", SPAXX/SPRXX) is "money_market". A plain cash/sweep position is "cash".
- For a broad US total-market or S&P 500 fund, use region "us", cap "large", style "blend".
- Leave a field null when you cannot determine it. Do not guess a cap/style for a bond or money-market fund.
Return ONLY a JSON array of {"id": string, "assetType": string, "region": string|null, "cap": string|null, "style": string|null, "sector": string|null} — one per input, echoing the input "id".`;

// One call classifies at most this many securities. A single all-in-one call
// (the old behaviour) reliably blew the client timeout once a sync introduced
// dozens of securities; small batches each return well under the per-call timeout.
export const CLASSIFY_CHUNK_SIZE = 12;

/** One claude-sonnet-4-6 call over a single batch of securities. Throws on failure. */
async function claudeClassifyBatch(securities: SecurityToClassify[], apiKey: string): Promise<SecurityTag[]> {
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  const user = `Classify each security:\n\n${JSON.stringify(securities)}`;
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  });
  const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim();
  return parseSecurityTags(text);
}

/**
 * Run `classifyBatch` over `securities` in chunks of `size`, concatenating the
 * tags. Batching keeps each API call small enough to finish inside the client
 * timeout no matter how many securities a sync introduces. A batch that throws
 * aborts the whole run (the caller treats that as `failed` and retries next sync).
 */
export async function classifyInChunks(
  securities: SecurityToClassify[],
  classifyBatch: ClassifyFn,
  size: number = CLASSIFY_CHUNK_SIZE,
): Promise<SecurityTag[]> {
  const out: SecurityTag[] = [];
  for (let i = 0; i < securities.length; i += size) {
    out.push(...await classifyBatch(securities.slice(i, i + size)));
  }
  return out;
}

/** Default classifier: batched claude-sonnet-4-6 calls in chunks. Throws on any failure. */
function claudeClassify(securities: SecurityToClassify[], apiKey: string): Promise<SecurityTag[]> {
  return classifyInChunks(securities, (batch) => claudeClassifyBatch(batch, apiKey));
}

/**
 * Classify every security still at tag_source 'plaid'/'seed' with Claude and
 * widen it to 'ai-confirmed'. Never throws: a classifier failure (or a missing
 * key) leaves those securities as-is to retry on the next sync, and reports
 * `failed: true`. 'ai-confirmed'/'user' rows are never selected or modified.
 */
export async function classifyUntaggedSecurities(
  db: Db = getDb(),
  opts: { apiKey?: string; classify?: ClassifyFn } = {},
): Promise<{ classified: number; failed: boolean }> {
  const untagged = db.select().from(schema.securities)
    .where(inArray(schema.securities.tagSource, ['plaid', 'seed'])).all();
  if (untagged.length === 0) return { classified: 0, failed: false };

  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
  const classify: ClassifyFn | null =
    opts.classify ?? (apiKey ? (secs) => claudeClassify(secs, apiKey) : null);
  if (!classify) {
    console.warn('[classify-securities] no ANTHROPIC_API_KEY; leaving securities untagged');
    return { classified: 0, failed: true };
  }

  const input: SecurityToClassify[] = untagged.map((s) => ({ id: s.id, ticker: s.ticker, name: s.name, kind: s.kind }));
  let tags: SecurityTag[];
  try {
    tags = await classify(input);
  } catch (err) {
    console.warn('[classify-securities] classification failed; leaving securities untagged:', String(err));
    return { classified: 0, failed: true };
  }

  const now = new Date().toISOString();
  let classified = 0;
  for (const t of tags) {
    const r = db.update(schema.securities)
      .set({ assetType: t.assetType, region: t.region, cap: t.cap, style: t.style, sector: t.sector, tagSource: 'ai-confirmed', modifiedAt: now })
      .where(and(eq(schema.securities.id, t.id), inArray(schema.securities.tagSource, ['plaid', 'seed'])))
      .run();
    if (r.changes > 0) classified += 1;
  }
  return { classified, failed: false };
}
