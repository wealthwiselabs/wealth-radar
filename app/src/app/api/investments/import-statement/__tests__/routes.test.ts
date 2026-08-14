// app/src/app/api/investments/import-statement/__tests__/routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { schema } from '@/db/client';

// Point getDb() at a fresh tmp DB for the commit route.
const { db } = makeTmpDb();
vi.mock('@/db/client', async (orig) => {
  const actual = await orig<typeof import('@/db/client')>();
  return { ...actual, getDb: () => db };
});
// snapshotDb is a no-op on an in-memory DB, but stub to be explicit/isolated.
vi.mock('@/lib/backup', () => ({ snapshotDb: () => null }));

import { POST as previewPOST } from '../preview/route';
import { POST as commitPOST } from '../commit/route';

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) as any;
}

describe('preview route validation', () => {
  const OLD = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => { delete process.env.ANTHROPIC_API_KEY; delete process.env.CLAUDE_API_KEY; });
  it('400s without pdfText', async () => {
    const res = await previewPOST(req({ fileName: 'x.pdf' }));
    expect(res.status).toBe(400);
  });
  it('401s without an API key', async () => {
    const res = await previewPOST(req({ pdfText: 'INVESTMENT REPORT ...', fileName: 'x.pdf' }));
    expect(res.status).toBe(401);
    if (OLD) process.env.ANTHROPIC_API_KEY = OLD;
  });
});

describe('commit route', () => {
  it('400s on invalid statements', async () => {
    const res = await commitPOST(req({ statements: [{ asOf: '2025-03-31' }] }));
    expect(res.status).toBe(400);
  });
  it('writes an account + snapshot for valid statements', async () => {
    const statements = [{
      accountRef: { institution: 'Fidelity', mask: null, planName: 'Acme' },
      asOf: '2025-03-31', reportedTotal: 300,
      holdings: [{ ticker: 'FXAIX', name: '500 Index', quantity: 1, value: 300 }],
      flows: [{ date: '2025-03-10', amount: 50, kind: 'contribution' }],
      activity: [],
    }];
    const res = await commitPOST(req({ statements }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ created: true, flows: 1 });
    expect(db.select().from(schema.accounts).all().length).toBe(1);
  });
});
