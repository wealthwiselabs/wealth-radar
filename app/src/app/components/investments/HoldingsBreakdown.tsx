'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatCurrency, formatPercent } from '@/lib/chartConfig';
import { ASSET_TYPES, REGIONS, CAPS, STYLES, SECTORS } from '@/lib/investments/tagVocab';
import { PURPOSES, type Purpose } from '@/lib/investments/purpose';
import type { AccountBreakdown } from '@/lib/investments/breakdown';
import { usePublishSection } from '@/app/hooks/usePublishSection';

interface BreakdownResponse { breakdown: AccountBreakdown[]; accounts: { id: string; name: string }[] }
type Holding = AccountBreakdown['holdings'][number];

const POS = 'var(--color-text-success)';
const NEG = 'var(--color-text-critical)';
function tone(n: number | null): string | undefined {
  if (n === null || n === 0) return undefined;
  return n > 0 ? POS : NEG;
}

/** Drop the fund-family prefix ("Vanguard Scottsdale Funds - X" → "X"). */
function shortName(name: string): string {
  const i = name.indexOf(' - ');
  return i >= 0 ? name.slice(i + 3) : name;
}

const KIND_OPTIONS = [
  { value: 'stock', label: 'Individual stock' },
  { value: 'etf', label: 'ETF' },
  { value: 'mutual_fund', label: 'Mutual fund' },
];

/** A holding's class tags, click-to-edit into inline selects that PATCH tag_source=user. */
function TagCell({ h, onSaved }: { h: Holding; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);
  const [v, setV] = useState({
    assetType: h.assetType ?? '', region: h.region ?? '', cap: h.cap ?? '', style: h.style ?? '', sector: h.sector ?? '', kind: h.kind ?? '',
  });

  const save = async () => {
    setSaving(true); setErr(false);
    try {
      const res = await fetch(`/api/investments/securities/${h.securityId}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assetType: v.assetType || null,
          region: v.region || null, cap: v.cap || null, style: v.style || null, sector: v.sector || null,
          kind: v.kind || null,
        }),
      });
      if (!res.ok) { setErr(true); return; }
      setEditing(false);
      onSaved();
    } catch { setErr(true); } finally { setSaving(false); }
  };

  if (!editing) {
    const tags = [h.assetType, h.kind === 'stock' ? 'individual stock' : null, h.region, h.cap, h.style, h.sector].filter(Boolean);
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Edit classification"
        className="text-left text-[var(--color-text-base-subdued)] hover:text-[var(--color-text-base-default)] hover:underline"
      >
        {tags.length ? tags.join(' · ') : 'untagged'}
      </button>
    );
  }

  const isEquity = v.assetType === 'equity';
  const pick = (label: string, value: string, options: readonly string[], set: (s: string) => void, allowBlank = true) => (
    <select aria-label={label} className="origin-select" value={value} onChange={(e) => set(e.target.value)}>
      {allowBlank && <option value="">{label}: —</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  return (
    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
      {pick('Class', v.assetType, ASSET_TYPES as readonly string[], (x) => setV((s) => ({ ...s, assetType: x })), false)}
      {isEquity && (
        <select aria-label="Kind" className="origin-select" value={v.kind}
          onChange={(e) => setV((s) => ({ ...s, kind: e.target.value }))}>
          <option value="">Kind: —</option>
          {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {isEquity && pick('Region', v.region, REGIONS, (x) => setV((s) => ({ ...s, region: x })))}
      {isEquity && pick('Cap', v.cap, CAPS, (x) => setV((s) => ({ ...s, cap: x })))}
      {isEquity && pick('Style', v.style, STYLES, (x) => setV((s) => ({ ...s, style: x })))}
      {isEquity && pick('Sector', v.sector, SECTORS, (x) => setV((s) => ({ ...s, sector: x })))}
      <button type="button" className="origin-btn origin-btn-primary" disabled={saving} onClick={save}>Save</button>
      <button type="button" className="origin-btn origin-btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
      {err && <span className="text-xsmall text-[var(--color-text-critical)]">Save failed</span>}
    </div>
  );
}

/** Per-holding purpose override. "Inherit" names the account's own purpose, so the
 *  effective value is readable without leaving the card. */
function PurposeCell({ accountId, h, accountPurpose, onSaved }: {
  accountId: string; h: Holding; accountPurpose: Purpose; onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);

  const save = async (next: string) => {
    setSaving(true); setErr(false);
    try {
      // A selection matching the account's own purpose is not a real override —
      // writing it verbatim would create a no-op row that is indistinguishable
      // from inheriting to the user but not to the return engine. Send null so
      // the database only ever holds the two states the engine reasons about.
      const purpose = next && next !== accountPurpose ? next : null;
      const res = await fetch(`/api/investments/accounts/${accountId}/security-purpose`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ securityId: h.securityId, purpose }),
      });
      if (!res.ok) { setErr(true); return; }
      onSaved();
    } catch { setErr(true); } finally { setSaving(false); }
  };

  return (
    <div className="flex items-center gap-[var(--space-2)]">
      <select
        aria-label={`Purpose for ${h.ticker ?? h.securityId}`}
        className="origin-select"
        value={h.purposeOverride ?? ''}
        disabled={saving}
        onChange={(e) => { void save(e.target.value); }}
      >
        <option value="">Inherit ({accountPurpose})</option>
        {PURPOSES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
      </select>
      {err && <span className="text-xsmall text-[var(--color-text-critical)]">Save failed</span>}
    </div>
  );
}

function AccountPanel({ b, onSaved }: { b: AccountBreakdown; onSaved: () => void }) {
  return (
    <div className="mb-[var(--space-5)]">
      <h3 className="heading-xsmall mb-[var(--space-2)] text-[var(--color-text-base-default)]">{b.accountName}</h3>

      {/* Balance summary */}
      <div className="flex flex-wrap gap-[var(--space-5)] mb-[var(--space-3)] text-small">
        <div><div className="text-[var(--color-text-base-subdued)]">Start</div><div>{b.startValue === null ? '—' : formatCurrency(b.startValue)}</div></div>
        <div><div className="text-[var(--color-text-base-subdued)]">End{b.endAsOf ? ` (${b.endAsOf})` : ''}</div><div>{b.endValue === null ? '—' : formatCurrency(b.endValue)}</div></div>
        <div><div className="text-[var(--color-text-base-subdued)]">Change</div><div style={{ color: tone(b.change) }}>{b.change === null ? '—' : formatCurrency(b.change)}</div></div>
        <div><div className="text-[var(--color-text-base-subdued)]">ROI</div><div style={{ color: b.roi.kind === 'ok' ? tone(b.roi.value) : undefined }}>{b.roi.kind === 'ok' ? formatPercent(b.roi.value) : 'unavailable'}</div></div>
      </div>

      {/* Holdings */}
      {b.holdings.length > 0 && (
        <div className="overflow-x-auto mb-[var(--space-3)]">
          <table className="w-full text-small">
            <thead>
              <tr className="text-[var(--color-text-base-subdued)] text-left border-b border-[var(--color-border-base-subdued)]">
                <th className="py-[var(--space-1)] px-[var(--space-2)] first:pl-0 font-medium">Ticker</th>
                <th className="py-[var(--space-1)] px-[var(--space-2)] font-medium">Name</th>
                <th className="py-[var(--space-1)] px-[var(--space-2)] font-medium">Class · Region · Cap · Style</th>
                <th className="py-[var(--space-1)] px-[var(--space-2)] font-medium">Purpose</th>
                <th className="py-[var(--space-1)] px-[var(--space-2)] font-medium text-right">Start</th>
                <th className="py-[var(--space-1)] px-[var(--space-2)] font-medium text-right">Value</th>
                <th className="py-[var(--space-1)] px-[var(--space-2)] font-medium text-right">ROI</th>
                <th className="py-[var(--space-1)] px-[var(--space-2)] font-medium text-right">% of acct</th>
              </tr>
            </thead>
            <tbody>
              {b.holdings.map((h) => (
                <tr key={h.securityId} className="border-b border-[var(--color-border-base-subdued)]">
                  <td className="py-[var(--space-1)] px-[var(--space-2)] first:pl-0 whitespace-nowrap">{h.ticker ?? '—'}</td>
                  <td className="py-[var(--space-1)] px-[var(--space-2)]">{shortName(h.name)}</td>
                  <td className="py-[var(--space-1)] px-[var(--space-2)]"><TagCell h={h} onSaved={onSaved} /></td>
                  <td className="py-[var(--space-1)] px-[var(--space-2)]">
                    <PurposeCell accountId={b.accountId} h={h} accountPurpose={b.accountPurpose} onSaved={onSaved} />
                  </td>
                  <td className="py-[var(--space-1)] px-[var(--space-2)] text-right whitespace-nowrap text-[var(--color-text-base-subdued)]">{h.startValue === null ? '—' : formatCurrency(h.startValue)}</td>
                  <td className="py-[var(--space-1)] px-[var(--space-2)] text-right whitespace-nowrap">{formatCurrency(h.value)}</td>
                  <td className="py-[var(--space-1)] px-[var(--space-2)] text-right whitespace-nowrap" style={{ color: h.roi.kind === 'ok' ? tone(h.roi.value) : undefined }} title={h.roi.kind === 'missing' ? h.roi.reason : undefined}>{h.roi.kind === 'ok' ? formatPercent(h.roi.value) : '—'}</td>
                  <td className="py-[var(--space-1)] px-[var(--space-2)] text-right whitespace-nowrap">{formatPercent(h.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Transactions in window */}
      {b.transactions.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-small">
            <thead>
              <tr className="text-[var(--color-text-base-subdued)] text-left border-b border-[var(--color-border-base-subdued)]">
                <th className="py-[var(--space-1)] px-[var(--space-2)] first:pl-0 font-medium">Date</th>
                <th className="py-[var(--space-1)] px-[var(--space-2)] font-medium">Type</th>
                <th className="py-[var(--space-1)] px-[var(--space-2)] font-medium">Security</th>
                <th className="py-[var(--space-1)] px-[var(--space-2)] font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {b.transactions.map((t) => (
                <tr key={t.id} className="border-b border-[var(--color-border-base-subdued)]">
                  <td className="py-[var(--space-1)] px-[var(--space-2)] first:pl-0 whitespace-nowrap">{t.date}</td>
                  <td className="py-[var(--space-1)] px-[var(--space-2)] whitespace-nowrap">{t.type}{t.subtype ? ` · ${t.subtype}` : ''}</td>
                  <td className="py-[var(--space-1)] px-[var(--space-2)]">{t.ticker ?? '—'}</td>
                  <td className="py-[var(--space-1)] px-[var(--space-2)] text-right whitespace-nowrap text-[var(--color-text-base-default)]">{formatCurrency(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xsmall text-[var(--color-text-base-subdued)]">No transactions in this window.</p>
      )}
    </div>
  );
}

export default function HoldingsBreakdown({ from, to }: { from: string; to: string }) {
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [account, setAccount] = useState('');           // one account at a time
  const [entry, setEntry] = useState<AccountBreakdown | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Populate the account list once, and default to the first account.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/investments/breakdown?account=all&from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('accounts'))))
      .then((j: BreakdownResponse) => {
        if (cancelled) return;
        setAccounts(j.accounts);
        // Default to the first account that actually has history, not the first
        // in the list (which may be an unlinked/empty account like US Bank).
        setAccount((prev) => prev || j.breakdown[0]?.accountId || j.accounts[0]?.id || '');
      })
      .catch(() => { if (!cancelled) setError('Failed to load accounts.'); });
    return () => { cancelled = true; };
  }, [from, to]);

  const load = useCallback(async () => {
    if (!account) return;
    setIsLoading(true); setError(null);
    try {
      const res = await fetch(`/api/investments/breakdown?account=${encodeURIComponent(account)}&from=${from}&to=${to}`);
      if (!res.ok) throw new Error('load');
      const j: BreakdownResponse = await res.json();
      setEntry(j.breakdown[0] ?? null);
    } catch {
      setError('Failed to load holdings breakdown.');
    } finally {
      setIsLoading(false);
    }
  }, [account, from, to]);

  useEffect(() => { void load(); }, [load]);

  usePublishSection(
    entry
      ? {
          id: 'investments.holdings',
          order: 30,
          title: 'Holdings breakdown',
          summary: `${accounts.length} account(s); showing ${entry.accountName}: ${
            entry.endValue == null ? '—' : `$${entry.endValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
          }, ${entry.holdings.length} holding(s)`,
          detail: { tool: 'get_holdings_breakdown', args: { account: 'all', from, to } },
        }
      : null,
  );

  return (
    <div className="origin-card-elevated p-[var(--space-4)]">
      <div className="flex items-center justify-between mb-[var(--space-4)] flex-wrap gap-[var(--space-3)]">
        <h2 className="heading-xsmall text-[var(--color-text-base-default)]">Holdings by account</h2>
        <div className="flex items-center gap-[var(--space-2)] flex-wrap">
          <select aria-label="Account" className="origin-select" value={account} onChange={(e) => setAccount(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">Loading holdings…</p>
      ) : error ? (
        <div className="flex items-center gap-[var(--space-3)]">
          <p className="text-small text-[var(--color-text-critical)]">{error}</p>
          <button type="button" className="origin-btn origin-btn-secondary" onClick={() => { void load(); }}>Retry</button>
        </div>
      ) : !entry ? (
        <p className="text-small text-[var(--color-text-base-subdued)]">No holdings history for this account yet.</p>
      ) : (
        <AccountPanel b={entry} onSaved={load} />
      )}
    </div>
  );
}
