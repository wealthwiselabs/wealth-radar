import { describe, it, expect, vi } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});

import { GET } from '../route';

const NOW = '2026-08-10T00:00:00.000Z';
const req = (qs: string) => new Request(`http://t/api/investments/grid?${qs}`) as never;

function seedEducationAndPortfolio() {
  for (const [id, name, purpose] of [
    ['a_edu', '529 Jerry', 'education'],
    ['a_port', 'Brokerage', 'portfolio'],
  ] as const) {
    db.insert(schema.accounts).values({
      id, name, institution: 'Vanguard', accountClass: 'investment', type: 'investment',
      origin: 'manual', status: 'active', purpose, owner: 'Alex', createdAt: NOW, modifiedAt: NOW,
    }).run();
  }
  db.insert(schema.securities).values({
    id: 'vti', ticker: 'VTI', name: 'VTI', kind: 'etf', assetType: 'equity', region: 'us',
    cap: 'large', style: 'blend', tagSource: 'seed', createdAt: NOW, modifiedAt: NOW,
  }).run();
  for (const acct of ['a_edu', 'a_port']) {
    for (const [sfx, asOf, v] of [['o', '2026-01-31', 1000], ['c', '2026-02-28', 1100]] as const) {
      const id = `${acct}-${sfx}`;
      db.insert(schema.investmentSnapshots).values({
        id, accountId: acct, asOf, month: asOf.slice(0, 7), source: 'statement',
        totalValue: v, holdingsComplete: true, note: '', createdAt: NOW, modifiedAt: NOW,
      }).run();
      db.insert(schema.snapshotHoldings).values({
        id: `${id}-h`, snapshotId: id, securityId: 'vti', quantity: null, value: v,
      }).run();
    }
  }
}

describe('GET /api/investments/grid purpose=education', () => {
  it('scopes the grid to education accounts only', async () => {
    seedEducationAndPortfolio();
    const res = await GET(req('basis=monthly&range=all&purpose=education'));
    const json = await res.json();
    const accountRows = json.grid.rows.filter((r: { kind: string }) => r.kind === 'account');
    expect(accountRows.map((r: { label: string }) => r.label).join(',')).toContain('529 Jerry');
    expect(accountRows.some((r: { label: string }) => r.label.includes('Brokerage'))).toBe(false);
  });
});

describe('GET /api/investments/grid explicit window', () => {
  it('honors from/to over the range derivation', async () => {
    const res = await GET(req('basis=monthly&from=2026-02-01&to=2026-02-28&purpose=portfolio'));
    const json = await res.json();
    expect(json.from).toBe('2026-02-01');
    expect(json.to).toBe('2026-02-28');
  });
});
