import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

const NOW = '2026-08-08T00:00:00.000Z';

describe('plaid_items.needs_investments_consent', () => {
  it('defaults to false and is settable', () => {
    const { db } = makeTmpDb();
    db.insert(schema.plaidItems).values({
      id: 'i1', plaidItemId: 'PLAID-i1', institutionName: 'US Bank', owner: 'Alex',
      accessToken: 'enc', status: 'healthy', createdAt: NOW, modifiedAt: NOW,
    }).run();
    expect(db.select().from(schema.plaidItems).all()[0].needsInvestmentsConsent).toBe(false);

    db.update(schema.plaidItems).set({ needsInvestmentsConsent: true }).run();
    expect(db.select().from(schema.plaidItems).all()[0].needsInvestmentsConsent).toBe(true);
  });
});
