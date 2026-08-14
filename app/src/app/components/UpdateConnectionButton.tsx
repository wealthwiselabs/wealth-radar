'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';

/** Reconnect one existing Plaid item via update mode (no new item, no duplicates). */
export default function UpdateConnectionButton({ itemId, flagged, onUpdated }: { itemId: string; flagged: boolean; onUpdated: () => void }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/plaid/link-token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId }),
    }).then((r) => r.json()).then((d) => setLinkToken(d.link_token ?? null)).catch(() => {});
  }, [itemId]);

  const onSuccess = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      // Update mode keeps the same access_token — no exchange. Just pull the item's data.
      const res = await fetch('/api/plaid/reauth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error || `Reconnect failed (${res.status})`); return; }
      onUpdated();
    } catch { setError('Could not reach the server.'); }
    finally { setBusy(false); }
  }, [itemId, onUpdated]);

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });

  return (
    <div className="flex flex-col items-end gap-[var(--space-1)]">
      <button
        type="button"
        className="origin-btn origin-btn-secondary"
        disabled={!ready || !linkToken || busy}
        onClick={() => open()}
      >
        {busy ? 'Working…' : flagged ? 'Add investments access' : 'Reconnect'}
      </button>
      {error && <span role="alert" className="text-xsmall text-[var(--color-text-critical)]">{error}</span>}
    </div>
  );
}
