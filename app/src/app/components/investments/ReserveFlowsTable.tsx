'use client';
import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/chartConfig';

interface ReserveFlow {
  id: string;
  accountId: string;
  accountLabel: string;
  date: string;
  amount: number;
  kind: string;
  note: string;
}

export default function ReserveFlowsTable({ from, to }: { from: string; to: string }) {
  const [flows, setFlows] = useState<ReserveFlow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    fetch(`/api/investments/flows?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) { setState('error'); return; }
        setFlows(d.flows ?? []);
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [from, to]);

  if (state === 'loading') {
    return <p className="text-small text-[var(--color-text-base-subdued)]">Loading…</p>;
  }
  if (state === 'error') {
    return <p className="text-small text-[var(--color-text-critical)]">Could not load reserve cash flows.</p>;
  }
  if (flows.length === 0) {
    return <p className="text-small text-[var(--color-text-base-subdued)]">No reserve cash flows recorded.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-small">
        <thead>
          <tr className="text-left text-xsmall uppercase text-[var(--color-text-base-subdued)]">
            <th className="py-[var(--space-2)] px-[var(--space-3)] first:pl-0 last:pr-0 font-medium">Date</th>
            <th className="py-[var(--space-2)] px-[var(--space-3)] first:pl-0 last:pr-0 font-medium">Account</th>
            <th className="py-[var(--space-2)] px-[var(--space-3)] first:pl-0 last:pr-0 font-medium">Kind</th>
            <th className="py-[var(--space-2)] px-[var(--space-3)] first:pl-0 last:pr-0 font-medium text-right">Amount</th>
            <th className="py-[var(--space-2)] px-[var(--space-3)] first:pl-0 last:pr-0 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {flows.map((f) => (
            <tr key={f.id} className="border-t border-[var(--color-border-base-subdued)]">
              <td className="py-[var(--space-2)] px-[var(--space-3)] first:pl-0 last:pr-0 whitespace-nowrap text-[var(--color-text-base-subdued)]">{f.date}</td>
              <td className="py-[var(--space-2)] px-[var(--space-3)] first:pl-0 last:pr-0 text-[var(--color-text-base-default)]">{f.accountLabel}</td>
              <td className="py-[var(--space-2)] px-[var(--space-3)] first:pl-0 last:pr-0 text-[var(--color-text-base-subdued)]">{f.kind}</td>
              <td
                className="py-[var(--space-2)] px-[var(--space-3)] first:pl-0 last:pr-0 text-right whitespace-nowrap font-medium"
                style={{ color: f.amount < 0 ? 'var(--color-text-critical)' : 'var(--color-text-success)' }}
              >
                {f.amount < 0 ? '-' : '+'}{formatCurrency(f.amount)}
              </td>
              <td className="py-[var(--space-2)] px-[var(--space-3)] first:pl-0 last:pr-0 text-[var(--color-text-base-subdued)]">{f.note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
