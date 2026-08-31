'use client';

import { useEffect, useState } from 'react';

interface Stale { accountId: string; name: string; lastAsOf: string | null; monthsOverdue: number }

export default function StaleStrip({ refreshKey }: { refreshKey: number }) {
  const [stale, setStale] = useState<Stale[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/net-worth/stale', { cache: 'no-store' });
        const body = await res.json();
        if (cancelled) return;
        // A non-OK response must not leave the previous fetch's items on
        // screen looking current — reset rather than hold stale state.
        setStale(res.ok ? (body.stale ?? []) : []);
      } catch {
        // A failed staleness check is not worth an error state — the register
        // still shows each row's age, which is the same information.
        if (!cancelled) setStale([]);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (stale.length === 0) return null;

  return (
    <div className="origin-card p-[var(--space-3)]">
      <p className="text-small text-[var(--color-text-base-default)]">
        Needs a look — {stale.length} item{stale.length === 1 ? '' : 's'} past their review date
      </p>
      <p className="text-xsmall text-[var(--color-text-base-subdued)]">
        {stale.map((s) => `${s.name} (${s.lastAsOf ?? 'never valued'})`).join(' · ')}
      </p>
      <p className="text-xsmall text-[var(--color-text-base-subdued)] mt-[var(--space-1)]">
        Their last value still counts toward your net worth — update them in the register below.
      </p>
    </div>
  );
}
