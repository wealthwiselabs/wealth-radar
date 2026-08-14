'use client';
import { useEffect, useState } from 'react';
import { formatPercent } from '@/lib/chartConfig';

interface Cell {
  return: { kind: 'ok'; value: number } | { kind: 'missing'; reason: string };
  fidelity?: 'chained' | 'single';
  excluded?: string[];
}
interface Row { kind: 'household' | 'account' | 'class'; id: string; label: string; owner?: string; cells: Cell[] }
interface Period { key: string; label: string; closeDate: string }
interface GridResponse { grid: { periods: Period[]; rows: Row[] }; from: string; to: string }

export function ReturnCell({ cell }: { cell: Cell }) {
  if (cell.return.kind === 'missing') {
    return (
      <td className="px-[var(--space-2)] py-[var(--space-1)] text-center text-[var(--color-text-base-disabled)]"
          title={`n/a — ${cell.return.reason}`}>—</td>
    );
  }
  const v = cell.return.value;
  const tone = v > 0 ? 'var(--color-text-success)' : v < 0 ? 'var(--color-text-critical)' : 'var(--color-text-base-subdued)';
  const flagged = cell.fidelity === 'single';
  const titleParts: string[] = [];
  if (flagged) titleParts.push('Lower fidelity: single-period estimate (a month was missing)');
  if (cell.excluded?.length) {
    titleParts.push(`Excludes ${cell.excluded.length} account(s): ${cell.excluded.join(', ')}`);
  }
  return (
    <td className="px-[var(--space-2)] py-[var(--space-1)] text-right whitespace-nowrap" style={{ color: tone }}
        title={titleParts.length ? titleParts.join(' — ') : undefined}>
      {formatPercent(v)}{flagged ? ' †' : ''}
    </td>
  );
}

export default function ReturnsGrid({ purpose = 'portfolio', title = 'Returns', basis: basisProp, from, to }:
  { purpose?: 'portfolio' | 'reserve' | 'education'; title?: string;
    basis?: 'monthly' | 'quarterly'; from?: string; to?: string }) {
  // Controlled window: when a parent passes from+to (the Education card on the
  // investments page), follow it and hide the internal selectors. Otherwise
  // self-controlled — the standalone Reserve page keeps its own basis/range.
  const controlled = Boolean(from && to);
  const [basisState, setBasis] = useState<'monthly' | 'quarterly'>('quarterly');
  const [rangeMode, setRangeMode] = useState<'default' | 'all'>('all');
  const basis = basisProp ?? basisState;
  const [data, setData] = useState<GridResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const range = rangeMode === 'all' ? 'all' : (basis === 'quarterly' ? '8' : '12');
    const url = controlled
      ? `/api/investments/grid?basis=${basis}&from=${from}&to=${to}&purpose=${purpose}`
      : `/api/investments/grid?basis=${basis}&range=${range}&purpose=${purpose}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { if (d.error) setError(d.error); else setData(d); } })
      .catch(() => { if (!cancelled) setError('Could not load returns.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [basis, rangeMode, purpose, controlled, from, to]);

  const rows = data?.grid.rows ?? [];
  const periods = data?.grid.periods ?? [];
  const accountRows = rows.filter((r) => r.kind === 'account');
  const classRows = rows.filter((r) => r.kind === 'class');
  const household = rows.find((r) => r.kind === 'household');

  return (
    <div className="origin-card-elevated p-[var(--space-4)]">
      <div className="flex items-center justify-between mb-[var(--space-4)] flex-wrap gap-[var(--space-3)]">
        <h2 className="heading-xsmall text-[var(--color-text-base-default)]">{title}</h2>
        {!controlled && (
          <div className="flex items-center gap-[var(--space-2)]">
            <select className="origin-select" value={basisState}
              onChange={(e) => setBasis(e.target.value as 'monthly' | 'quarterly')}>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
            <select className="origin-select" value={rangeMode}
              onChange={(e) => setRangeMode(e.target.value as 'default' | 'all')}>
              <option value="default">
                {basisState === 'quarterly' ? 'Trailing 8 quarters' : 'Trailing 12 months'}
              </option>
              <option value="all">All history</option>
            </select>
          </div>
        )}
      </div>

      {loading ? <p className="text-small text-[var(--color-text-base-subdued)]">Loading…</p>
       : error ? <p className="text-small text-[var(--color-text-critical)]">{error}</p>
       : periods.length === 0 ? <p className="text-small text-[var(--color-text-base-subdued)]">No periods with data yet.</p>
       : (
        <div className="overflow-x-auto">
          <table className="text-small border-collapse">
            <thead>
              <tr>
                <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium text-[var(--color-text-base-subdued)] sticky left-0 bg-[var(--color-background-base-default)]" />
                {periods.map((p) => (
                  <th key={p.key} title={p.closeDate}
                    className="py-[var(--space-2)] px-[var(--space-2)] font-medium text-right text-[var(--color-text-base-subdued)] whitespace-nowrap">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {household && (
                <tr className="border-t border-[var(--color-border-base-default)]">
                  <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-medium sticky left-0 bg-[var(--color-background-base-default)] whitespace-nowrap">
                    {household.label}
                  </th>
                  {household.cells.map((c, i) => <ReturnCell key={i} cell={c} />)}
                </tr>
              )}
              {/* account rows grouped by owner — emit an owner heading row when owner changes,
                  exactly like AccountCoverageGrid; label cell sticky left. */}
              {accountRows.map((row, idx) => {
                const showOwner = idx === 0 || accountRows[idx - 1].owner !== row.owner;
                return (
                  <RowGroup key={row.id} row={row} showHeading={showOwner}
                    heading={row.owner || 'Unassigned'} colSpan={periods.length + 1} />
                );
              })}
              {classRows.length > 0 && (
                <tr>
                  <th colSpan={periods.length + 1}
                    className="text-left pt-[var(--space-4)] pb-[var(--space-1)] px-[var(--space-3)] font-medium text-xsmall uppercase tracking-wide text-[var(--color-text-base-subdued)] sticky left-0 bg-[var(--color-background-base-default)]">
                    By asset class — gross of contributions &amp; reallocations
                  </th>
                </tr>
              )}
              {classRows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--color-border-base-subdued)]">
                  <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-normal sticky left-0 bg-[var(--color-background-base-default)] whitespace-nowrap text-[var(--color-text-base-subdued)]">
                    {row.label}
                  </th>
                  {row.cells.map((c, i) => <ReturnCell key={i} cell={c} />)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-[var(--space-3)] text-xsmall text-[var(--color-text-base-subdued)]">
            — = no snapshot at a period endpoint. † = single-period estimate (a month was missing).
          </p>
        </div>
      )}
    </div>
  );
}

function RowGroup({ row, showHeading, heading, colSpan }:
  { row: Row; showHeading: boolean; heading: string; colSpan: number }) {
  return (
    <>
      {showHeading && (
        <tr>
          <th colSpan={colSpan}
            className="text-left pt-[var(--space-4)] pb-[var(--space-1)] px-[var(--space-3)] font-medium text-xsmall uppercase tracking-wide text-[var(--color-text-base-subdued)] sticky left-0 bg-[var(--color-background-base-default)]">
            {heading}
          </th>
        </tr>
      )}
      <tr className="border-t border-[var(--color-border-base-subdued)]">
        <th className="text-left py-[var(--space-2)] px-[var(--space-3)] font-normal sticky left-0 bg-[var(--color-background-base-default)] whitespace-nowrap">
          {row.label}
        </th>
        {row.cells.map((c, i) => <ReturnCell key={i} cell={c} />)}
      </tr>
    </>
  );
}
