'use client';

import { Fragment, useEffect, useState } from 'react';
import type { CoverageResult, CellState } from '@/lib/coverage';

interface AccountCoverageGridProps {
  /** How many trailing months to show. Defaults to 12 (matches the API default). */
  monthsBack?: number;
  /** Bump this (e.g. after a sync or account change) to force a refetch. */
  refreshKey?: number;
}

/**
 * "Alex Chase Freedom" -> "Chase Freedom" when rendered under a "Alex"
 * group heading. Falls back to the full string if the owner isn't the prefix,
 * so a manually-renamed account never loses part of its name.
 */
function stripOwner(display: string, owner: string): string {
  if (!owner) return display;
  const prefix = `${owner} `;
  return display.startsWith(prefix) ? display.slice(prefix.length) : display;
}

/** "2026-07" -> "Jul '26" */
function formatMonth(month: string): string {
  const [y, m] = month.split('-');
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  const label = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${label} '${y.slice(2)}`;
}

const CELL_STYLE: Record<CellState, { background: string; color: string }> = {
  covered: {
    background: 'var(--color-background-success-subdued)',
    color: 'var(--color-text-success)',
  },
  missing: {
    background: 'var(--color-background-critical-subdued)',
    color: 'var(--color-text-critical)',
  },
  na: {
    background: 'var(--color-background-base-subdued)',
    color: 'var(--color-text-base-disabled)',
  },
};

function CoverageCell({ month, state, reason }: { month: string; state: CellState; reason?: string }) {
  const style = CELL_STYLE[state];
  const title =
    state === 'missing'
      ? `${month}: ${reason ?? 'missing'}`
      : state === 'covered'
        ? `${month}: covered`
        : `${month}: n/a`;
  return (
    <td className="px-[var(--space-1)] py-[var(--space-1)] text-center" title={title}>
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-1)] text-xsmall"
        style={style}
      >
        {state === 'covered' ? '✓' : state === 'missing' ? '●' : ''}
      </span>
    </td>
  );
}

export default function AccountCoverageGrid({ monthsBack = 12, refreshKey }: AccountCoverageGridProps) {
  const [data, setData] = useState<CoverageResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetch(`/api/coverage?monthsBack=${monthsBack}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load coverage');
        return res.json();
      })
      .then((json: CoverageResult) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load coverage.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [monthsBack, refreshKey]);

  return (
    <details className="origin-card-elevated p-[var(--space-4)]">
      <summary className="flex items-center gap-[var(--space-2)] cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="text-[var(--color-text-base-subdued)] transition-transform [details[open]_&]:rotate-90"
        >
          ▸
        </span>
        <h3 className="heading-xsmall text-[var(--color-text-base-default)]">Account Coverage</h3>
      </summary>

      <div className="mt-[var(--space-4)]">
        <div className="flex items-center justify-end gap-[var(--space-4)] text-xsmall text-[var(--color-text-base-subdued)] mb-[var(--space-4)] flex-wrap">
          <span className="flex items-center gap-[var(--space-1)]">
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-[var(--radius-1)]"
              style={CELL_STYLE.covered}
            >
              {'✓'}
            </span>
            Covered
          </span>
          <span className="flex items-center gap-[var(--space-1)]">
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-[var(--radius-1)]"
              style={CELL_STYLE.missing}
            >
              {'●'}
            </span>
            Missing
          </span>
          <span className="flex items-center gap-[var(--space-1)]">
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded-[var(--radius-1)]"
              style={CELL_STYLE.na}
            />
            N/a
          </span>
        </div>

        {isLoading ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">Loading coverage...</p>
      ) : error ? (
        <p className="text-small text-[var(--color-text-critical)]">{error}</p>
      ) : !data || data.accounts.length === 0 ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">No accounts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-small border-collapse">
            <thead>
              <tr>
                <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)] sticky left-0 bg-[var(--color-background-base-default)] whitespace-nowrap">
                  Account
                </th>
                {data.months.map((month) => (
                  <th
                    key={month}
                    className="py-[var(--space-2)] px-[var(--space-1)] font-medium text-[var(--color-text-base-subdued)] whitespace-nowrap"
                    title={month}
                  >
                    {formatMonth(month)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((account, i) => {
                // The API returns accounts already grouped by owner, so a change
                // from the previous row starts a new person's block.
                const startsGroup = i === 0 || data.accounts[i - 1].owner !== account.owner;
                return (
                  <Fragment key={account.accountId}>
                    {startsGroup && (
                      <tr>
                        <th
                          colSpan={data.months.length + 1}
                          className="text-left pt-[var(--space-4)] pb-[var(--space-1)] px-[var(--space-3)] font-medium text-xsmall uppercase tracking-wide text-[var(--color-text-base-subdued)] sticky left-0 bg-[var(--color-background-base-default)]"
                        >
                          {account.owner || 'Unassigned'}
                        </th>
                      </tr>
                    )}
                    <tr className="border-t border-[var(--color-border-base-subdued)]">
                      <td className="py-[var(--space-2)] px-[var(--space-3)] text-[var(--color-text-base-default)] sticky left-0 bg-[var(--color-background-base-default)] whitespace-nowrap">
                        {/* Owner is already the group heading — don't repeat it on every row. */}
                        {stripOwner(account.display, account.owner)}
                        {account.status === 'closed' && (
                          <span className="ml-[var(--space-1)] text-xsmall text-[var(--color-text-base-subdued)]">
                            (closed{account.closedAtMonth ? ` ${account.closedAtMonth}` : ''})
                          </span>
                        )}
                      </td>
                      {account.cells.map((cell) => (
                        <CoverageCell key={cell.month} month={cell.month} state={cell.state} reason={cell.reason} />
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </details>
  );
}
