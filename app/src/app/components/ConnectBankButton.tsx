'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { ACCOUNT_OWNERS } from '@/lib/owners';

export default function ConnectBankButton({ onConnected }: { onConnected: () => void }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Auto-merges happen without asking, so say which accounts were folded into
  // existing history — a silent merge looks like an account failed to appear.
  const [notice, setNotice] = useState<string | null>(null);
  // Whose login is being connected. Captured BEFORE Plaid Link opens, because
  // every account discovered on the Item inherits it — without this the
  // accounts land unassigned and have to be tagged one by one afterwards.
  const [owner, setOwner] = useState<string>('');
  // usePlaidLink builds the Plaid handler in an effect keyed only on
  // [loading, error, publicKey, token, products] — onSuccess is NOT a
  // dependency. The handler is therefore created when the token arrives (on
  // mount, before any owner is picked) and captures that render's onSuccess
  // forever. Reading the owner from a ref makes the stale closure see the
  // current value; without this every connection posts owner: ''.
  const ownerRef = useRef(owner);
  useEffect(() => { ownerRef.current = owner; }, [owner]);

  useEffect(() => {
    fetch('/api/plaid/link-token', { method: 'POST' })
      .then((r) => r.json()).then((d) => setLinkToken(d.link_token ?? null)).catch(() => {});
  }, []);

  const onSuccess = useCallback(async (public_token: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Plaid Link succeeding only means the bank authorised us. If the exchange
      // fails, NOTHING is stored — so we must stop and say so. Previously the
      // response was ignored, the sync ran against no new Item, and the UI
      // reported success while no accounts had been created.
      const res = await fetch('/api/plaid/exchange', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_token, owner: ownerRef.current }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Could not save the connection (HTTP ${res.status}). No accounts were added.`);
        return;
      }
      const merged: string[] = body.merged ?? [];
      setNotice(merged.length
        ? `Continued existing history for: ${merged.join(', ')}.`
        : null);
      const sync = await fetch('/api/plaid/sync', { method: 'POST' });
      if (!sync.ok) {
        setError('Bank connected, but the first sync failed. Use "Sync now" to retry.');
      }
      onConnected();
    } catch {
      setError('Could not reach the server. No accounts were added.');
    } finally { setBusy(false); }
  }, [onConnected]);

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });

  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      {error && (
        <p
          role="alert"
          className="text-small p-[var(--space-2)] rounded-[var(--radius-2)] bg-[var(--color-background-critical-subdued)] text-[var(--color-text-critical)]"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="text-small p-[var(--space-2)] rounded-[var(--radius-2)] bg-[var(--color-background-info-subdued)] text-[var(--color-text-base-default)]">
          {notice}
        </p>
      )}
      <div className="flex items-center gap-[var(--space-2)] flex-wrap">
      <label className="flex items-center gap-[var(--space-2)] text-small text-[var(--color-text-base-subdued)]">
        Whose bank?
        <select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className="origin-input"
          aria-label="Account owner for this bank connection"
          disabled={busy}
        >
          <option value="">Choose…</option>
          {ACCOUNT_OWNERS.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </label>
      <button
        className="origin-btn origin-btn-primary"
        // Owner is required: an unassigned Item silently produces unassigned
        // accounts, which is the exact problem this selector exists to prevent.
        disabled={!ready || !linkToken || busy || !owner}
        onClick={() => open()}
        title={!owner ? 'Pick whose bank this is first' : undefined}
      >
        {busy ? 'Connecting…' : 'Connect a bank'}
      </button>
      </div>
    </div>
  );
}
