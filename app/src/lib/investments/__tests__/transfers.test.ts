import { describe, it, expect } from 'vitest';
import { netInterAccountTransfers, type FlowRow } from '@/lib/investments/transfers';

function f(over: Partial<FlowRow>): FlowRow {
  return { id: crypto.randomUUID(), accountId: 'a1', date: '2026-03-10', amount: 100, kind: 'contribution', ...over };
}

describe('netInterAccountTransfers', () => {
  it('drops a matched pair moving money between two tracked accounts', () => {
    const flows = [
      f({ accountId: 'vanguard', amount: -283000, kind: 'transfer_out' }),
      f({ accountId: 'fidelity', amount: 283000, kind: 'transfer_in' }),
    ];
    expect(netInterAccountTransfers(flows)).toHaveLength(0);
  });

  it('keeps real contributions', () => {
    const flows = [f({ accountId: 'a1', amount: 1000, kind: 'contribution' })];
    expect(netInterAccountTransfers(flows)).toHaveLength(1);
  });

  it('matches within the date window but not outside it', () => {
    const near = [
      f({ accountId: 'x', date: '2026-03-10', amount: -500, kind: 'transfer_out' }),
      f({ accountId: 'y', date: '2026-03-12', amount: 500, kind: 'transfer_in' }),
    ];
    expect(netInterAccountTransfers(near, 5)).toHaveLength(0);

    const far = [
      f({ accountId: 'x', date: '2026-03-01', amount: -500, kind: 'transfer_out' }),
      f({ accountId: 'y', date: '2026-03-30', amount: 500, kind: 'transfer_in' }),
    ];
    expect(netInterAccountTransfers(far, 5)).toHaveLength(2);
  });

  it('does not match a near-miss amount', () => {
    const flows = [
      f({ accountId: 'x', amount: -500, kind: 'transfer_out' }),
      f({ accountId: 'y', amount: 499, kind: 'transfer_in' }),
    ];
    expect(netInterAccountTransfers(flows)).toHaveLength(2);
  });

  it('does not match two flows in the same account', () => {
    const flows = [
      f({ accountId: 'x', amount: -500, kind: 'transfer_out' }),
      f({ accountId: 'x', amount: 500, kind: 'transfer_in' }),
    ];
    expect(netInterAccountTransfers(flows)).toHaveLength(2);
  });

  it('pairs each flow at most once', () => {
    const flows = [
      f({ accountId: 'x', amount: -500, kind: 'transfer_out' }),
      f({ accountId: 'y', amount: 500, kind: 'transfer_in' }),
      f({ accountId: 'z', amount: 500, kind: 'transfer_in' }),
    ];
    expect(netInterAccountTransfers(flows)).toHaveLength(1);
  });
});
