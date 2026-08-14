import { eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';

type Db = ReturnType<typeof getDb>;

export type SecurityKind =
  | 'etf' | 'mutual_fund' | 'stock' | 'collective_trust' | 'insurance' | 'other';
export type AssetType =
  | 'equity' | 'bond' | 'money_market' | 'cash' | 'insurance' | 'other';

export type SecurityRow = typeof schema.securities.$inferSelect;

export interface SecurityInput {
  ticker: string | null;
  name: string;
  kind?: SecurityKind;
  assetType?: AssetType;
  region?: string | null;
  cap?: string | null;
  style?: string | null;
  sector?: string | null;
  tagSource?: string;
}

/** Tickers are matched case-insensitively; names are matched on collapsed whitespace. */
export function normalizeTicker(t: string | null): string | null {
  const v = (t ?? '').trim().toUpperCase();
  return v || null;
}

export function normalizeName(n: string): string {
  return n.trim().toLowerCase().replace(/\s+/g, ' ');
}

const TAG_PRECEDENCE: Record<string, number> = { seed: 0, plaid: 1, 'ai-confirmed': 2, user: 3 };

/**
 * Find a security by ticker, or by normalized name when it has no ticker, and
 * create it if absent.
 *
 * Tags are only widened, never narrowed: an incoming `seed` tag never
 * overwrites one a human confirmed. A wrong tag silently corrupts every
 * allocation chart downstream, so this fails closed.
 */
export async function resolveOrCreateSecurity(
  input: SecurityInput,
  db: Db = getDb(),
): Promise<SecurityRow> {
  const ticker = normalizeTicker(input.ticker);
  const now = new Date().toISOString();

  let existing: SecurityRow | undefined;
  if (ticker) {
    existing = db.select().from(schema.securities)
      .where(eq(schema.securities.ticker, ticker)).get();
  } else {
    const wanted = normalizeName(input.name);
    existing = db.select().from(schema.securities)
      .where(isNull(schema.securities.ticker)).all()
      .find((r) => normalizeName(r.name) === wanted);
  }

  if (existing) {
    const incoming = TAG_PRECEDENCE[input.tagSource ?? 'seed'] ?? 0;
    const current = TAG_PRECEDENCE[existing.tagSource] ?? 0;
    if (incoming <= current) return existing;

    const patch = {
      // kind/assetType are widened by a more authoritative source too, but never
      // wiped: a source that omits them (e.g. a bare user re-tag) keeps what we had.
      kind: input.kind ?? existing.kind,
      assetType: input.assetType ?? existing.assetType,
      region: input.region ?? existing.region,
      cap: input.cap ?? existing.cap,
      style: input.style ?? existing.style,
      sector: input.sector ?? existing.sector,
      tagSource: input.tagSource!,
      modifiedAt: now,
    };
    db.update(schema.securities).set(patch)
      .where(eq(schema.securities.id, existing.id)).run();
    return { ...existing, ...patch };
  }

  const row: typeof schema.securities.$inferInsert = {
    id: crypto.randomUUID(),
    ticker,
    name: input.name.trim(),
    kind: input.kind ?? 'other',
    assetType: input.assetType ?? 'other',
    region: input.region ?? null,
    cap: input.cap ?? null,
    style: input.style ?? null,
    sector: input.sector ?? null,
    tagSource: input.tagSource ?? 'seed',
    createdAt: now,
    modifiedAt: now,
  };
  db.insert(schema.securities).values(row).run();
  return db.select().from(schema.securities).where(eq(schema.securities.id, row.id)).get()!;
}
