'use client';

import Link from 'next/link';
import { formatCurrency } from '@/lib/chartConfig';

export interface PurposeSummary {
  purpose: string;
  /** null means "not known" — no snapshots, or the newest one is incomplete. */
  value: number | null;
  /** When present, the tile becomes a link to this path. */
  href?: string;
}

const LABELS: Record<string, string> = {
  portfolio: 'Total Investments',
  reserve: 'Reserve',
  insurance: 'Insurance',
  education: 'Education (529)',
};

const NOTES: Record<string, string> = {
  portfolio: 'total value, latest',
  reserve: 'emergency fund',
  insurance: 'excluded from ROI',
  education: 'future tuition',
};

/**
 * Hover text spelling out each tile's scope.
 *
 * The portfolio tile is the one that needs it: it sums *every* portfolio-purpose
 * investment account at its most recent reading, which is why it can sit well
 * above the Portfolio trend line, whose earlier months predate some of those
 * accounts' first snapshot. 529 college-savings accounts are tracked separately
 * in the Education tile, and Reserve and insurance in their own tiles, so this
 * figure is the investable portfolio rather than every asset.
 */
const SCOPE: Record<string, string> = {
  portfolio:
    'Every portfolio-purpose account at its latest reported value. 529 college-savings accounts are tracked separately in the Education tile; Reserve and insurance in their own tiles.',
  reserve: 'Money market held deliberately as an emergency fund, with its own ROI.',
  insurance: 'Counted in total assets, excluded from ROI entirely.',
  education:
    'Money in 529 college-savings accounts, earmarked for future tuition. Counted in net worth but excluded from the investable portfolio; has its own ROI.',
};

export default function PurposeTiles({ summaries }: { summaries: PurposeSummary[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-[var(--space-4)]">
      {summaries.map((s) => {
        const scope = SCOPE[s.purpose];
        const content = (
          <>
            <p
              className="text-small text-[var(--color-text-base-subdued)]"
              title={scope}
            >
              {LABELS[s.purpose] ?? s.purpose}
              {scope ? (
                <span
                  aria-hidden="true"
                  className="ml-[var(--space-1)] text-[var(--color-text-base-disabled)] cursor-help"
                >
                  ⓘ
                </span>
              ) : null}
            </p>
            {/* An unknown total renders as an em dash, never $0. A missing
                account is not an empty one, and the difference is the whole
                point of the tile. */}
            {s.value === null ? (
              <p className="heading-medium text-[var(--color-text-base-disabled)]"
                title="Not all accounts reported">—</p>
            ) : (
              <p className="heading-medium text-[var(--color-text-base-default)]">
                {formatCurrency(s.value)}
              </p>
            )}
            <p className="text-xsmall text-[var(--color-text-base-subdued)]">{NOTES[s.purpose] ?? ''}</p>
            {s.href ? (
              <p className="text-xsmall text-[var(--color-text-brand)] mt-[var(--space-1)]">View →</p>
            ) : null}
          </>
        );

        if (s.href) {
          return (
            <Link key={s.purpose} href={s.href}
              className="origin-card p-[var(--space-4)] block hover:bg-[var(--color-background-base-hover)]">
              {content}
            </Link>
          );
        }

        return (
          <div key={s.purpose} className="origin-card p-[var(--space-4)]">
            {content}
          </div>
        );
      })}
    </div>
  );
}
