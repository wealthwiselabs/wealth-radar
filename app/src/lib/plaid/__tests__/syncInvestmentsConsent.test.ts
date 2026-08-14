import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';
import { syncInvestments } from '@/lib/plaid/syncInvestments';

vi.mock('@/lib/crypto', () => ({ decryptToken: (s: string) => s, encryptToken: (s: string) => s }));

const NOW = '2026-08-08T00:00:00.000Z';
function addItem(db: ReturnType<typeof makeTmpDb>['db'], over: Partial<typeof schema.plaidItems.$inferInsert> = {}) {
  const id = over.id ?? 'i1';
  db.insert(schema.plaidItems).values({
    id, plaidItemId: 'PLAID-' + id, institutionName: 'US Bank', owner: 'Alex',
    accessToken: 'enc-token', status: 'healthy', createdAt: NOW, modifiedAt: NOW, ...over,
  }).run();
  return db.select().from(schema.plaidItems).all().find((r) => r.id === id)!;
}
// A fake Plaid client: throws a Plaid-shaped error, or returns holdings.
const consentError = { response: { data: { error_code: 'ADDITIONAL_CONSENT_REQUIRED' } } };
function clientThrowingConsent() {
  return { investmentsHoldingsGet: async () => { throw consentError; }, accountsGet: async () => { throw consentError; } } as never;
}
function clientWithHoldings() {
  return { investmentsHoldingsGet: async () => ({ data: { accounts: [], holdings: [], securities: [] } }) } as never;
}

describe('syncInvestments consent flag', () => {
  it('sets needsInvestmentsConsent=true on ADDITIONAL_CONSENT_REQUIRED', async () => {
    const { db } = makeTmpDb();
    addItem(db);
    const item = db.select().from(schema.plaidItems).all()[0];
    await syncInvestments(item, { client: clientThrowingConsent() }, db);
    expect(db.select().from(schema.plaidItems).all()[0].needsInvestmentsConsent).toBe(true);
  });
  it('clears the flag on a successful holdings fetch', async () => {
    const { db } = makeTmpDb();
    addItem(db, { needsInvestmentsConsent: true });
    const item = db.select().from(schema.plaidItems).all()[0];
    await syncInvestments(item, { client: clientWithHoldings() }, db);
    expect(db.select().from(schema.plaidItems).all()[0].needsInvestmentsConsent).toBe(false);
  });
});
