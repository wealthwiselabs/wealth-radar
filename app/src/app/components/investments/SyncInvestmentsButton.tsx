'use client';
import { useEffect, useState } from 'react';

export default function SyncInvestmentsButton({ onSynced }: { onSynced: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // In the header there is no room for a persistent result string, so the
  // outcome shows briefly and then clears itself.
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  const sync = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/investments/sync', { method: 'POST' });
      const d = await r.json();
      setMsg(r.ok ? `Synced ${d.snapshots ?? 0} snapshot(s) across ${d.items ?? 0} connection(s)` : (d.error ?? 'Sync failed'));
      if (r.ok) onSynced();
    } catch {
      setMsg('Sync failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-[var(--space-2)]">
      {msg && (
        <span className="text-xsmall text-[var(--color-text-base-subdued)] whitespace-nowrap">{msg}</span>
      )}
      <button
        className="origin-btn origin-btn-secondary flex items-center gap-[var(--space-2)]"
        disabled={busy}
        onClick={sync}
        title="Pull the latest values and holdings from your connected investment accounts"
      >
        <svg
          className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {busy ? 'Syncing…' : 'Sync investments'}
      </button>
    </div>
  );
}
