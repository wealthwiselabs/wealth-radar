'use client';

import { useMemo } from 'react';
import { CHART_PALETTE, CHART_DANGER, CHART_INK, formatSignedCurrency } from '@/lib/chartConfig';
import type { RegisterRow } from '@/app/net-worth/page';

export interface WaterfallStep {
  label: string;
  delta: number;
  runningAfter: number;
  kind: 'asset' | 'liability' | 'total';
}

const ASSET_ORDER: Array<[string, string]> = [
  ['cash', 'Cash'],
  ['investments', 'Investments'],
  ['property', 'Property'],
  ['vehicles', 'Vehicles'],
  ['other', 'Other assets'],
];

/**
 * Gross assets by group, then each debt, then the net figure.
 *
 * Groups with nothing valued in them are omitted rather than drawn as zero
 * bars — an empty step reads as "you have none of this", which is a claim the
 * data does not support when the item simply has not been valued.
 *
 * Pure and exported separately from the component so it can be unit tested
 * without a DOM (this repo's vitest config has no jsdom environment).
 */
export function buildWaterfall(rows: RegisterRow[]): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  let running = 0;

  for (const [group, label] of ASSET_ORDER) {
    const valued = rows.filter((r) => r.side === 'asset' && r.group === group && r.value !== null);
    if (valued.length === 0) continue;
    const total = valued.reduce((sum, r) => sum + (r.value as number), 0);
    running += total;
    steps.push({ label, delta: total, runningAfter: running, kind: 'asset' });
  }

  const debts = rows
    .filter((r) => r.side === 'liability' && r.value !== null)
    .sort((a, b) => (b.value as number) - (a.value as number));

  for (const r of debts) {
    const amount = r.value as number;
    running -= amount;
    steps.push({ label: r.name, delta: -amount, runningAfter: running, kind: 'liability' });
  }

  steps.push({ label: 'Net worth', delta: running, runningAfter: running, kind: 'total' });
  return steps;
}

const CHART_HEIGHT = 160;

export default function NetWorthWaterfall({ rows }: { rows: RegisterRow[] }) {
  const steps = useMemo(() => buildWaterfall(rows), [rows]);

  // Scale from the FULL range of the running total, including below zero —
  // a household whose liabilities exceed its assets (e.g. a new mortgage) will
  // swing the running total negative, and a bar that only accounts for the
  // high side of each step's range would overflow its container and produce
  // a negative margin. Always include 0 so the baseline sits inside the
  // range, and guard the degenerate all-zero case so nothing divides by zero.
  const bounds = steps.flatMap((s) => [s.runningAfter, s.runningAfter - s.delta]);
  const lo = Math.min(0, ...bounds);
  const hi = Math.max(0, ...bounds);
  const span = hi - lo || 1;

  const color = (kind: WaterfallStep['kind']) =>
    kind === 'liability' ? CHART_DANGER : kind === 'total' ? CHART_INK : CHART_PALETTE[0];

  return (
    <div className="origin-card-elevated p-[var(--space-6)]">
      <h2 className="heading-xsmall text-[var(--color-text-base-default)]">Where it stands today</h2>
      <p className="text-xsmall text-[var(--color-text-base-subdued)] mb-[var(--space-4)]">
        Current values only — this section ignores the selected time range.
      </p>
      <div className="flex items-end gap-[var(--space-2)]" style={{ height: 200 }}>
        {steps.map((s) => {
          const top = Math.max(s.runningAfter, s.runningAfter - s.delta);
          const bottom = Math.min(s.runningAfter, s.runningAfter - s.delta);
          const height = Math.max(((top - bottom) / span) * CHART_HEIGHT, 3);
          const offset = ((bottom - lo) / span) * CHART_HEIGHT;
          return (
            <div key={s.label} className="flex-1 flex flex-col items-center justify-end" style={{ height: 200 }}>
              <div
                title={`${s.label}: ${formatSignedCurrency(s.delta)}`}
                style={{
                  width: '100%', height, marginBottom: offset,
                  background: color(s.kind), borderRadius: 4,
                }}
              />
              <span className="text-xsmall text-[var(--color-text-base-subdued)] mt-[var(--space-1)] text-center">
                {s.label}
              </span>
              <span className="text-xsmall text-[var(--color-text-base-default)] tabular-nums">
                {formatSignedCurrency(s.delta)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
