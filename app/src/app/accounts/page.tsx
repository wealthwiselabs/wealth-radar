'use client';

import { useCallback, useEffect, useState } from 'react';
import ConnectBankButton from '../components/ConnectBankButton';
import ConnectionsPanel from '../components/ConnectionsPanel';
import ImportPanel from '../components/ImportPanel';
import AccountCoverageGrid from '../components/AccountCoverageGrid';
import AccountsPanel from '../components/AccountsPanel';
import AccountTable, { type AccountRow } from '../components/investments/AccountTable';
import AddInvestmentAccount from '../components/investments/AddInvestmentAccount';
import { useAppConfig } from '../hooks/useAppConfig';
import type { Category } from '@/types';
import { notifyDataChanged } from '@/lib/dataEvents';

/**
 * The accounts hub: what you have. Bank connections and statement imports up
 * top, then the two account groups — bank accounts and investment accounts.
 * Performance and allocation live on /investments.
 */
export default function AccountsPage() {
  const config = useAppConfig();
  const [categories, setCategories] = useState<Category[]>([]);
  // Bumped after an import / connection / bank-account edit so the coverage grid
  // and the bank accounts table both re-read.
  const [refreshKey, setRefreshKey] = useState(0);
  const [invAccounts, setInvAccounts] = useState<AccountRow[]>([]);

  useEffect(() => {
    fetch('/api/taxonomy')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setCategories(data.categories ?? []); })
      .catch(() => {});
  }, []);

  const loadInvestments = useCallback(async () => {
    try {
      const res = await fetch('/api/investments/accounts');
      if (!res.ok) return;
      const data = await res.json();
      setInvAccounts(data.accounts ?? []);
    } catch {
      // Leave the prior list rather than blanking it on a transient failure.
    }
  }, []);

  useEffect(() => { void loadInvestments(); }, [loadInvestments]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    notifyDataChanged();
    void loadInvestments();
  }, [loadInvestments]);

  const handlePurposeChange = useCallback(async (id: string, purpose: string) => {
    await fetch(`/api/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose }),
    });
    await loadInvestments();
  }, [loadInvestments]);

  const handleRename = useCallback(async (id: string, name: string) => {
    await fetch(`/api/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await loadInvestments();
  }, [loadInvestments]);

  const handleRemoveInvestment = useCallback(async (id: string) => {
    if (!window.confirm('Remove this account and all its data? This cannot be undone.\n\nIf it is synced from a connected bank, it may reappear on the next sync — Disconnect the connection to remove it permanently.')) return;
    const res = await fetch(`/api/accounts/${id}/remove`, { method: 'POST' });
    if (!res.ok) {
      window.alert('Could not remove the account.');
      return;
    }
    refresh();
  }, [refresh]);

  return (
    <main className="min-h-screen p-[var(--space-6)] max-w-6xl mx-auto">
      <div className="mb-[var(--space-6)]">
        <h1 className="heading-large text-[var(--color-text-base-default)]">Accounts &amp; Data</h1>
        <p className="text-small text-[var(--color-text-base-subdued)]">
          Connect banks, import statements, and manage your bank and investment accounts.
        </p>
      </div>

      <section className="mb-[var(--space-8)]">
        <h2 className="heading-xsmall text-[var(--color-text-base-default)] mb-[var(--space-3)]">
          Add data
        </h2>
        <ImportPanel categories={categories} onImported={refresh}>
          {config.plaidEnabled && (
            <div className="origin-card-elevated p-[var(--space-6)] mb-[var(--space-4)]">
              <ConnectBankButton onConnected={refresh} />
            </div>
          )}
        </ImportPanel>
      </section>

      {config.plaidEnabled && <ConnectionsPanel refreshKey={refreshKey} onChanged={refresh} />}

      <section className="mb-[var(--space-8)]">
        <AccountCoverageGrid refreshKey={refreshKey} />
      </section>

      <section className="mb-[var(--space-8)]">
        <h2 className="heading-xsmall text-[var(--color-text-base-default)] mb-[var(--space-1)]">
          Bank accounts
        </h2>
        <p className="text-small text-[var(--color-text-base-subdued)] mb-[var(--space-3)]">
          Click an account name to set its owner or rename it. You can also close or merge duplicates.
        </p>
        <AccountsPanel key={refreshKey} onChanged={refresh} />
      </section>

      <section>
        <h2 className="heading-xsmall text-[var(--color-text-base-default)] mb-[var(--space-3)]">
          Investment accounts
        </h2>
        <div className="origin-card-elevated p-[var(--space-6)] mb-[var(--space-4)]">
          <AccountTable accounts={invAccounts} onPurposeChange={handlePurposeChange} onRename={handleRename} onRemove={handleRemoveInvestment} />
        </div>
        <AddInvestmentAccount onCreated={refresh} />
      </section>
    </main>
  );
}
