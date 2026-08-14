'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatPercent } from '@/lib/chartConfig';
import type { AllocNode } from '@/lib/investments/allocation';
import type { PeriodReturn } from '@/lib/investments/returns';

interface AllocationResponse {
  tree: AllocNode | null;
}

/** Currency cell: right-aligned, `—` (subdued) for a null value. */
function MoneyCell({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <td className="py-[var(--space-2)] px-[var(--space-3)] text-right whitespace-nowrap text-[var(--color-text-base-disabled)]">
        —
      </td>
    );
  }
  return (
    <td className="py-[var(--space-2)] px-[var(--space-3)] text-right whitespace-nowrap text-[var(--color-text-base-default)]">
      {formatCurrency(value)}
    </td>
  );
}

/**
 * Signed currency cell (Contributions, Δ Value): explicit textual sign plus
 * color, so sign isn't conveyed by color alone. Zero is neutral (no forced
 * sign), matching the ReserveFlowsTable convention.
 */
function SignedMoneyCell({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <td className="py-[var(--space-2)] px-[var(--space-3)] text-right whitespace-nowrap text-[var(--color-text-base-disabled)]">
        —
      </td>
    );
  }
  const tone =
    value > 0
      ? 'var(--color-text-success)'
      : value < 0
        ? 'var(--color-text-critical)'
        : 'var(--color-text-base-subdued)';
  const sign = value < 0 ? '-' : value > 0 ? '+' : '';
  return (
    <td className="py-[var(--space-2)] px-[var(--space-3)] text-right whitespace-nowrap" style={{ color: tone }}>
      {sign}{formatCurrency(value)}
    </td>
  );
}

/** ROI: colored by sign, `—` + tooltip when missing. */
function RoiCell({ roi }: { roi: PeriodReturn }) {
  if (roi.kind === 'missing') {
    return (
      <td
        className="py-[var(--space-2)] px-[var(--space-3)] last:pr-0 text-right whitespace-nowrap text-[var(--color-text-base-disabled)]"
        title={roi.reason}
      >
        —
      </td>
    );
  }
  const value = roi.value;
  const tone =
    value > 0
      ? 'var(--color-text-success)'
      : value < 0
        ? 'var(--color-text-critical)'
        : 'var(--color-text-base-subdued)';
  return (
    <td
      className="py-[var(--space-2)] px-[var(--space-3)] last:pr-0 text-right whitespace-nowrap"
      style={{ color: tone }}
    >
      {formatPercent(value)}
    </td>
  );
}

/** % of total: a plain unsigned percentage plus a subtle inline bar. */
function PctCell({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <td className="py-[var(--space-2)] px-[var(--space-3)] text-right whitespace-nowrap text-[var(--color-text-base-disabled)]">
        —
      </td>
    );
  }
  const width = Math.max(0, Math.min(1, pct)) * 100;
  return (
    <td className="py-[var(--space-2)] px-[var(--space-3)] text-right whitespace-nowrap">
      <span className="inline-flex items-center gap-[var(--space-2)] justify-end w-full">
        <span className="text-[var(--color-text-base-default)]">{(pct * 100).toFixed(1)}%</span>
        <span
          className="relative inline-block w-12 h-1.5 rounded-full overflow-hidden bg-[var(--color-background-base-subdued)]"
          aria-hidden="true"
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${width}%`, background: 'var(--color-background-brand-subdued)' }}
          />
        </span>
      </span>
    </td>
  );
}

function Row({
  node,
  expanded,
  toggle,
}: {
  node: AllocNode;
  expanded: Set<string>;
  toggle: (key: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.key);
  return (
    <>
      <tr className="border-t border-[var(--color-border-base-subdued)]">
        <td className="py-[var(--space-2)] px-[var(--space-3)] first:pl-0">
          <span className="flex items-center" style={{ paddingLeft: node.depth * 16 }}>
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggle(node.key)}
                className="mr-[var(--space-1)] inline-flex items-center justify-center w-4 h-4 text-[var(--color-text-base-subdued)]"
                aria-label={isOpen ? `Collapse ${node.label}` : `Expand ${node.label}`}
                aria-expanded={isOpen}
              >
                {isOpen ? '▾' : '▸'}
              </button>
            ) : (
              <span className="mr-[var(--space-1)] inline-block w-4 h-4" aria-hidden="true" />
            )}
            <span className="text-[var(--color-text-base-default)] whitespace-nowrap">{node.label}</span>
          </span>
        </td>
        <MoneyCell value={node.startBalance} />
        <MoneyCell value={node.balance} />
        <PctCell pct={node.pctOfTotal} />
        <SignedMoneyCell value={node.contributions} />
        <SignedMoneyCell value={node.valueChange} />
        <RoiCell roi={node.roi} />
      </tr>
      {hasChildren && isOpen && node.children.map((child) => (
        <Row key={child.key} node={child} expanded={expanded} toggle={toggle} />
      ))}
    </>
  );
}

export default function AllocationTree({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<AllocationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetch(`/api/investments/allocation/range?from=${from}&to=${to}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load allocation');
        return res.json();
      })
      .then((json: AllocationResponse) => {
        if (cancelled) return;
        if ('error' in json) throw new Error('Failed to load allocation');
        setData(json);
        // Default-expand the top level and its immediate children.
        if (json.tree) {
          const next = new Set<string>([json.tree.key]);
          for (const child of json.tree.children) next.add(child.key);
          setExpanded(next);
        } else {
          setExpanded(new Set());
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load allocation.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const tree = data?.tree ?? null;

  return (
    <div className="origin-card-elevated p-[var(--space-4)]">
      {isLoading ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">Loading allocation...</p>
      ) : error ? (
        <p className="text-small text-[var(--color-text-critical)]">{error}</p>
      ) : !tree || tree.children.length === 0 ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">No allocation data for this window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-small">
            <thead>
              <tr className="text-left text-xsmall uppercase text-[var(--color-text-base-subdued)]">
                <th className="py-[var(--space-2)] px-[var(--space-3)] first:pl-0 font-medium">Node</th>
                <th className="py-[var(--space-2)] px-[var(--space-3)] font-medium text-right">Start</th>
                <th className="py-[var(--space-2)] px-[var(--space-3)] font-medium text-right">Balance</th>
                <th className="py-[var(--space-2)] px-[var(--space-3)] font-medium text-right">% of total</th>
                <th className="py-[var(--space-2)] px-[var(--space-3)] font-medium text-right">Contributions</th>
                <th className="py-[var(--space-2)] px-[var(--space-3)] font-medium text-right">Δ Value</th>
                <th className="py-[var(--space-2)] px-[var(--space-3)] last:pr-0 font-medium text-right">ROI</th>
              </tr>
            </thead>
            <tbody>
              <Row node={tree} expanded={expanded} toggle={toggle} />
            </tbody>
          </table>
        </div>
      )}
      {tree && tree.balanceAccounts !== undefined && tree.accountsCounted !== undefined
        && tree.accountsCounted < tree.balanceAccounts && (
        <p className="mt-[var(--space-3)] text-xsmall text-[var(--color-text-base-subdued)]">
          Balances reflect all {tree.balanceAccounts} accounts as of the window end. ROI and change cover the
          {' '}{tree.accountsCounted} with a snapshot at the window start — the other
          {' '}{tree.balanceAccounts - tree.accountsCounted} show “—”.
        </p>
      )}
      {tree && tree.balance !== null && (() => {
        const classified = tree.children.reduce((s, c) => s + (c.balance ?? 0), 0);
        const remainder = tree.balance - classified;
        return Math.abs(remainder) < 1 ? null : (
          <p className="mt-[var(--space-3)] text-xsmall text-[var(--color-text-base-subdued)]">
            {formatCurrency(remainder)} not classified — held in accounts that reported a total without holdings detail.
          </p>
        );
      })()}
    </div>
  );
}
