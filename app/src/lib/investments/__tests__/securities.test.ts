import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { resolveOrCreateSecurity } from '@/lib/investments/securities';
import { securities } from '@/db/schema';

describe('resolveOrCreateSecurity', () => {
  it('creates a security and returns it', async () => {
    const { db } = makeTmpDb();
    const s = await resolveOrCreateSecurity(
      { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', kind: 'etf', assetType: 'equity' }, db);
    expect(s.ticker).toBe('VTI');
    expect(s.kind).toBe('etf');
    expect(db.select().from(securities).all()).toHaveLength(1);
  });

  it('matches an existing security by ticker, case-insensitively', async () => {
    const { db } = makeTmpDb();
    const a = await resolveOrCreateSecurity({ ticker: 'VGT', name: 'Vanguard IT' }, db);
    const b = await resolveOrCreateSecurity({ ticker: 'vgt', name: 'Vanguard Information Tech' }, db);
    expect(b.id).toBe(a.id);
    expect(db.select().from(securities).all()).toHaveLength(1);
  });

  it('matches a tickerless security by normalized name', async () => {
    const { db } = makeTmpDb();
    const a = await resolveOrCreateSecurity({ ticker: null, name: 'Stable Value Fund' }, db);
    const b = await resolveOrCreateSecurity({ ticker: null, name: '  stable   value fund ' }, db);
    expect(b.id).toBe(a.id);
  });

  it('keeps two different tickerless securities apart', async () => {
    const { db } = makeTmpDb();
    await resolveOrCreateSecurity({ ticker: null, name: 'Stable Value Fund' }, db);
    await resolveOrCreateSecurity({ ticker: null, name: 'RMB Money Fund' }, db);
    expect(db.select().from(securities).all()).toHaveLength(2);
  });

  it('does not overwrite a user-confirmed tag with a seed value', async () => {
    const { db } = makeTmpDb();
    await resolveOrCreateSecurity(
      { ticker: 'VBR', name: 'Small Cap Value', cap: 'small', style: 'value', tagSource: 'user' }, db);
    const again = await resolveOrCreateSecurity(
      { ticker: 'VBR', name: 'Small Cap Value', cap: 'large', tagSource: 'seed' }, db);
    expect(again.cap).toBe('small');
    expect(again.tagSource).toBe('user');
  });

  it('does not overwrite a user tag with a plaid tag', async () => {
    const { db } = makeTmpDb();
    await resolveOrCreateSecurity(
      { ticker: 'VGT', name: 'Vanguard IT', cap: 'large', tagSource: 'user' }, db);
    const again = await resolveOrCreateSecurity(
      { ticker: 'VGT', name: 'Vanguard IT', cap: 'small', tagSource: 'plaid' }, db);
    expect(again.cap).toBe('large');
    expect(again.tagSource).toBe('user');
  });

  it('overwrites a seed tag with a plaid tag', async () => {
    const { db } = makeTmpDb();
    await resolveOrCreateSecurity(
      { ticker: 'VTI', name: 'Total Stock', cap: 'large', tagSource: 'seed' }, db);
    const again = await resolveOrCreateSecurity(
      { ticker: 'VTI', name: 'Total Stock', cap: 'small', tagSource: 'plaid' }, db);
    expect(again.cap).toBe('small');
    expect(again.tagSource).toBe('plaid');
  });

  it('improves kind/assetType when a higher-precedence source supplies them', async () => {
    const { db } = makeTmpDb();
    await resolveOrCreateSecurity(
      { ticker: 'EWZ', name: 'iShares Brazil', kind: 'other', assetType: 'other', tagSource: 'seed' }, db);
    const again = await resolveOrCreateSecurity(
      { ticker: 'EWZ', name: 'iShares Brazil', kind: 'etf', assetType: 'equity', tagSource: 'plaid' }, db);
    expect(again.kind).toBe('etf');
    expect(again.assetType).toBe('equity');
  });

  it('does not wipe an existing kind/assetType when the higher-precedence source omits them', async () => {
    const { db } = makeTmpDb();
    await resolveOrCreateSecurity(
      { ticker: 'VGT', name: 'Vanguard IT', kind: 'etf', assetType: 'equity', tagSource: 'seed' }, db);
    const again = await resolveOrCreateSecurity(
      { ticker: 'VGT', name: 'Vanguard IT', tagSource: 'user' }, db);
    expect(again.kind).toBe('etf');
    expect(again.assetType).toBe('equity');
  });
});
