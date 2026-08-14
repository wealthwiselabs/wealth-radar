'use client';
import { useState } from 'react';
import { ACCOUNT_OWNER_OPTIONS as OWNERS } from '@/lib/owners';

const PURPOSES = ['portfolio', 'reserve', 'insurance'];

export default function AddInvestmentAccount({ onCreated }: { onCreated: () => void }) {
  const [institution, setInstitution] = useState('');
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [purpose, setPurpose] = useState('portfolio');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/investments/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institution, name, owner, purpose }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? 'Could not create account'); return; }
      setInstitution(''); setName(''); setOwner(''); setPurpose('portfolio');
      onCreated();
    } catch {
      setError('Could not create account');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="origin-card-elevated p-[var(--space-6)] space-y-[var(--space-3)]">
      <h2 className="heading-xsmall text-[var(--color-text-base-default)]">Add an account Plaid can’t reach</h2>
      <div className="flex flex-wrap gap-[var(--space-2)]">
        <input className="origin-input text-small" placeholder="Institution"
          value={institution} onChange={(e) => setInstitution(e.target.value)} />
        <input className="origin-input text-small" placeholder="Account name"
          value={name} onChange={(e) => setName(e.target.value)} />
        <select className="origin-select text-small" value={owner}
          onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          {OWNERS.map((o) => <option key={o || 'none'} value={o}>{o || '(no owner)'}</option>)}
        </select>
        <select className="origin-select text-small" value={purpose}
          onChange={(e) => setPurpose(e.target.value)} aria-label="Purpose">
          {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="submit" disabled={busy || !institution.trim() || !name.trim()}
          className="origin-btn origin-btn-secondary">
          {busy ? 'Adding…' : 'Add account'}
        </button>
      </div>
      {error && <p className="text-xsmall text-[var(--color-text-critical)]">{error}</p>}
    </form>
  );
}
