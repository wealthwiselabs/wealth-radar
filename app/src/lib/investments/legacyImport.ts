import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { commitSnapshot } from '@/lib/investments/snapshots';
import { resolveOrCreateSecurity, type AssetType } from '@/lib/investments/securities';

type Db = ReturnType<typeof getDb>;

export interface LegacyQuarter {
  label: string;
  start: string;       // YYYY-MM-DD
  end: string;         // YYYY-MM-DD
  startValue: number;
  endValue: number;
  contributions: number;
}

export interface LegacyClassRow {
  className: string;
  quarters: LegacyQuarter[];
}

/**
 * The sheet's asset-class names, mapped onto tag dimensions. A legacy class
 * name *is* a tag, so the import populates tags for free even though the
 * tagging UI does not exist yet.
 */
export const LEGACY_CLASS_TAGS: Record<
  string,
  { region?: string; cap?: string; style?: string; sector?: string; assetType: AssetType }
> = {
  'Bond':             { assetType: 'bond' },
  'CA Muni Bond':     { assetType: 'bond' },
  'L-Cap Growth':     { assetType: 'equity', region: 'us', cap: 'large', style: 'growth' },
  'L-Cap Value':      { assetType: 'equity', region: 'us', cap: 'large', style: 'value' },
  'L-Cap Index':      { assetType: 'equity', region: 'us', cap: 'large', style: 'blend' },
  'M-Cap Index':      { assetType: 'equity', region: 'us', cap: 'mid',   style: 'blend' },
  'S-Cap Growth':     { assetType: 'equity', region: 'us', cap: 'small', style: 'growth' },
  'S-Cap Value':      { assetType: 'equity', region: 'us', cap: 'small', style: 'value' },
  'S-Cap Index':      { assetType: 'equity', region: 'us', cap: 'small', style: 'blend' },
  'Small Cap Index':  { assetType: 'equity', region: 'us', cap: 'small', style: 'blend' },
  'Total US Index':   { assetType: 'equity', region: 'us', cap: 'large', style: 'blend' },
  'Tech Index':       { assetType: 'equity', region: 'us', cap: 'large', style: 'growth', sector: 'technology' },
  'Intl Dev Mkt':     { assetType: 'equity', region: 'intl_developed', style: 'blend' },
  'Emerging Mkt':     { assetType: 'equity', region: 'intl_emerging',  style: 'blend' },
  'Intl EMG Mkt':     { assetType: 'equity', region: 'intl_emerging',  style: 'blend' },
  'REI':              { assetType: 'equity', region: 'us', sector: 'real_estate' },
  'Cash':             { assetType: 'cash' },
};

/**
 * Import legacy quarters as snapshots plus dated cash flows.
 *
 * Contributions are dated at the *quarter start*, giving them a Dietz weight of
 * 1. That reduces the return formula to (V1−V0−F)/(V0+F) — precisely the
 * arithmetic the source spreadsheet used — so imported quarters reproduce it
 * exactly and the import is verifiable. The sheet supplies no flow dates;
 * inventing mid-quarter ones would be fabrication and would forfeit that check.
 */
export async function importLegacyQuarters(
  accountId: string,
  rows: LegacyClassRow[],
  db: Db = getDb(),
): Promise<{ snapshots: number; flows: number }> {
  const now = new Date().toISOString();

  // Resolve each class's security once; reused for holdings and for the
  // securityId on its contribution flows.
  const securityIdByClass = new Map<string, string>();
  for (const row of rows) {
    const tags = LEGACY_CLASS_TAGS[row.className];
    const sec = await resolveOrCreateSecurity({
      ticker: null, name: `Legacy: ${row.className}`, kind: 'other',
      assetType: tags?.assetType ?? 'other',
      region: tags?.region ?? null, cap: tags?.cap ?? null,
      style: tags?.style ?? null, sector: tags?.sector ?? null,
      tagSource: 'seed',
    }, db);
    securityIdByClass.set(row.className, sec.id);
  }

  // Class value per boundary date → one snapshot with several holdings.
  const byDate = new Map<string, Map<string, number>>();
  for (const row of rows) {
    for (const q of row.quarters) {
      for (const [date, value] of [[q.start, q.startValue], [q.end, q.endValue]] as const) {
        const classes = byDate.get(date) ?? new Map<string, number>();
        classes.set(row.className, (classes.get(row.className) ?? 0) + value);
        byDate.set(date, classes);
      }
    }
  }

  let snapshots = 0;
  for (const [asOf, classes] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const holdings = [...classes.entries()].map(([className, value]) => ({
      ticker: null, name: `Legacy: ${className}`, quantity: null, value,
    }));
    await commitSnapshot({
      accountId, asOf, source: 'legacy',
      totalValue: [...classes.values()].reduce((s, v) => s + v, 0),
      holdings, note: 'imported from ROI-26 sheet',
    }, db);
    snapshots += 1;
  }

  // One contribution flow per (class, quarter-start), attributed to its security.
  // Summed at household level this is identical to the old single flow, so
  // household/account ROI is unchanged; only the attribution is finer.
  let flows = 0;
  for (const row of rows) {
    const securityId = securityIdByClass.get(row.className)!;
    for (const q of row.quarters) {
      if (q.contributions === 0) continue;
      const existing = db.select().from(schema.cashFlows).where(and(
        eq(schema.cashFlows.accountId, accountId),
        eq(schema.cashFlows.date, q.start),
        eq(schema.cashFlows.securityId, securityId),
        eq(schema.cashFlows.source, 'legacy'),
      )).get();
      if (existing) {
        db.update(schema.cashFlows).set({ amount: q.contributions, modifiedAt: now })
          .where(eq(schema.cashFlows.id, existing.id)).run();
      } else {
        db.insert(schema.cashFlows).values({
          id: crypto.randomUUID(), accountId, securityId,
          date: q.start, amount: q.contributions, kind: 'contribution', source: 'legacy',
          confirmed: true,
          note: 'imported from ROI-26 sheet; date is the quarter start, not the actual date',
          createdAt: now, modifiedAt: now,
        }).run();
      }
      flows += 1;
    }
  }

  return { snapshots, flows };
}
