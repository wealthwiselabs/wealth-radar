import { describe, it, expect } from 'vitest';
import { applyAccountPatch, PURPOSES } from '@/lib/accountLifecycle';
import type { AccountRow } from '@/lib/accounts';

function makeAccount(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acc-1',
    name: 'Credit Card',
    institution: 'Chase',
    mask: null,
    owner: '',
    nameSource: 'derived',
    accountClass: 'spending',
    purpose: 'portfolio',
    type: 'unknown',
    subtype: null,
    origin: 'manual',
    plaidItemId: null,
    plaidAccountId: null,
    closedAtMonth: null,
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    modifiedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('applyAccountPatch', () => {
  it('closing without a date defaults closedAtMonth to the current month', () => {
    const existing = makeAccount({ status: 'active', closedAtMonth: null });
    const patch = applyAccountPatch(existing, { status: 'closed' });
    const currentMonth = new Date().toISOString().slice(0, 7);
    expect(patch.status).toBe('closed');
    expect(patch.closedAtMonth).toBe(currentMonth);
  });

  it('reopening (status: active) clears closedAtMonth to null', () => {
    const existing = makeAccount({ status: 'closed', closedAtMonth: '2024-06' });
    const patch = applyAccountPatch(existing, { status: 'active' });
    expect(patch.status).toBe('active');
    expect(patch.closedAtMonth).toBeNull();
  });

  it('closing with an explicit closedAtMonth uses the provided value', () => {
    const existing = makeAccount({ status: 'active', closedAtMonth: null });
    const patch = applyAccountPatch(existing, { status: 'closed', closedAtMonth: '2024-03' });
    expect(patch.closedAtMonth).toBe('2024-03');
  });

  it('closing when a closedAtMonth already exists and none is given keeps the existing value', () => {
    const existing = makeAccount({ status: 'active', closedAtMonth: '2024-02' });
    const patch = applyAccountPatch(existing, { status: 'closed' });
    expect(patch.closedAtMonth).toBe('2024-02');
  });

  it('rename sets name and leaves other fields untouched', () => {
    const existing = makeAccount({ name: 'Credit Card' });
    const patch = applyAccountPatch(existing, { name: 'Sapphire Preferred' });
    expect(patch.name).toBe('Sapphire Preferred');
    expect(patch.status).toBe('active');
    expect(patch.owner).toBe('');
  });

  it('omitting name keeps the existing name', () => {
    const existing = makeAccount({ name: 'Credit Card' });
    const patch = applyAccountPatch(existing, { status: 'active' });
    expect(patch.name).toBe('Credit Card');
  });

  it('always bumps modifiedAt', () => {
    const existing = makeAccount({ modifiedAt: '2020-01-01T00:00:00.000Z' });
    const patch = applyAccountPatch(existing, { name: 'New Name' });
    expect(patch.modifiedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('applyAccountPatch purpose', () => {
  it('sets purpose when provided', () => {
    const existing = makeAccount({ purpose: 'portfolio' });
    expect(applyAccountPatch(existing, { purpose: 'reserve' }).purpose).toBe('reserve');
  });

  it('leaves purpose unchanged when omitted', () => {
    const existing = makeAccount({ purpose: 'insurance' });
    expect(applyAccountPatch(existing, { owner: 'Sam' }).purpose).toBe('insurance');
  });

  it('accepts education as a settable purpose', () => {
    const existing = makeAccount({ purpose: 'portfolio' });
    expect(applyAccountPatch(existing, { purpose: 'education' }).purpose).toBe('education');
  });

  it('exposes exactly the four valid purposes (mirrors the route rule)', () => {
    expect([...PURPOSES]).toEqual(['portfolio', 'reserve', 'insurance', 'education']);
  });
});
