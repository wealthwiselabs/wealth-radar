'use client';
import { useCallback, useEffect, useState } from 'react';
import UpdateConnectionButton from './UpdateConnectionButton';
import { findDuplicateConnections } from '@/lib/plaid/duplicateConnections';

interface ConnItem {
  id: string; institutionName: string | null; owner: string; status: string;
  error: string | null; needsInvestmentsConsent: boolean; lastSyncedAt: string | null;
}

/** Health badge for a connection, or null when healthy. */
function badge(item: ConnItem): { text: string; flagged: boolean } | null {
  if (item.needsInvestmentsConsent) return { text: 'Needs investments access', flagged: true };
  if (item.status === 'login_required' || item.error?.includes('ITEM_LOGIN_REQUIRED')) return { text: 'Login expired — reconnect', flagged: false };
  if (item.status === 'error') return { text: 'Connection error — reconnect', flagged: false };
  return null;
}

export default function ConnectionsPanel({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [items, setItems] = useState<ConnItem[]>([]);
  const load = useCallback(() => {
    fetch('/api/plaid/status').then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(d.items ?? [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (items.length === 0) return null;

  const dupGroups = findDuplicateConnections(items);
  // itemId → recommendedKeepId for quick per-row lookup
  const dupByItem = new Map<string, string>();
  for (const g of dupGroups) {
    for (const id of g.itemIds) dupByItem.set(id, g.recommendedKeepId);
  }

  return (
    <section className="mb-[var(--space-8)]">
      <h2 className="heading-xsmall text-[var(--color-text-base-default)] mb-[var(--space-3)]">Bank connections</h2>
      {dupGroups.length > 0 && (
        <div className="mb-[var(--space-3)] p-[var(--space-3)] rounded-[var(--radius-2)] bg-[var(--color-background-warning-subdued)] text-small text-[var(--color-text-base-default)]">
          Duplicate connections detected. You have more than one connection to the same bank — Disconnect the extra one (keep the recommended one) to avoid duplicate accounts.
        </div>
      )}
      <div className="origin-card-elevated overflow-hidden">
        {items.map((item) => {
          const b = badge(item);
          return (
            <div key={item.id} className="flex items-center justify-between gap-[var(--space-3)] p-[var(--space-4)] border-t border-[var(--color-border-base-subdued)] first:border-t-0 flex-wrap">
              <div>
                <div className="text-medium text-[var(--color-text-base-default)]">
                  {item.institutionName ?? 'Bank'} <span className="text-[var(--color-text-base-subdued)]">· {item.owner || 'unassigned'}</span>
                  {dupByItem.has(item.id) && (
                    <span className="ml-[var(--space-2)] text-xsmall text-[var(--color-text-warning)]">
                      · duplicate{dupByItem.get(item.id)! === item.id ? ' (recommended to keep)' : ' (recommended to remove)'}
                    </span>
                  )}
                </div>
                <div className="text-xsmall text-[var(--color-text-base-subdued)]">
                  {item.lastSyncedAt ? `last synced ${item.lastSyncedAt.slice(0, 10)}` : 'not synced yet'}
                  {b && <span className="ml-[var(--space-2)] text-[var(--color-text-warning)]">· {b.text}</span>}
                </div>
              </div>
              <div className="flex gap-[var(--space-2)]">
                <UpdateConnectionButton itemId={item.id} flagged={!!b?.flagged} onUpdated={() => { load(); onChanged(); }} />
                <button
                  type="button"
                  className="origin-btn origin-btn-secondary"
                  onClick={async () => {
                    if (!window.confirm(`Disconnect ${item.institutionName ?? 'this bank'} (${item.owner})? This removes the connection and its accounts from the app.`)) return;
                    const res = await fetch('/api/plaid/item/remove', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: item.id }),
                    });
                    if (res.ok) { load(); onChanged(); }
                  }}
                >
                  Disconnect
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
