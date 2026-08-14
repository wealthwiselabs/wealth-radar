import { describe, it, expect } from 'vitest';
import { findDuplicateConnections, type DupInput } from '@/lib/plaid/duplicateConnections';

const base = (over: Partial<DupInput> & { id: string }): DupInput => ({
  institutionName: 'U.S. Bank', owner: 'Alex', status: 'healthy',
  needsInvestmentsConsent: false, lastSyncedAt: null, ...over,
});

describe('findDuplicateConnections', () => {
  it('returns no groups when all connections are distinct', () => {
    expect(findDuplicateConnections([
      base({ id: 'a', institutionName: 'US Bank' }),
      base({ id: 'b', institutionName: 'Chase' }),
    ])).toEqual([]);
  });

  it('groups two connections to the same institution + owner', () => {
    const groups = findDuplicateConnections([
      base({ id: 'a' }), base({ id: 'b' }),
      base({ id: 'c', institutionName: 'Chase' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].itemIds.sort()).toEqual(['a', 'b']);
    expect(groups[0].owner).toBe('Alex');
  });

  it('does NOT group same institution across different owners', () => {
    expect(findDuplicateConnections([
      base({ id: 'a', owner: 'Alex' }),
      base({ id: 'b', owner: 'Sam' }),
    ])).toEqual([]);
  });

  it('matches institution names case/space-insensitively', () => {
    const groups = findDuplicateConnections([
      base({ id: 'a', institutionName: 'U.S. Bank' }),
      base({ id: 'b', institutionName: '  u.s. bank ' }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('recommends keeping the healthy item over a flagged one', () => {
    const groups = findDuplicateConnections([
      base({ id: 'needsConsent', needsInvestmentsConsent: true }),
      base({ id: 'healthy' }),
    ]);
    expect(groups[0].recommendedKeepId).toBe('healthy');
  });

  it('tie-breaks equally-healthy items by most recent lastSyncedAt', () => {
    const groups = findDuplicateConnections([
      base({ id: 'old', lastSyncedAt: '2026-01-01' }),
      base({ id: 'new', lastSyncedAt: '2026-08-01' }),
    ]);
    expect(groups[0].recommendedKeepId).toBe('new');
  });

  it('does not group items with a null/empty institution name', () => {
    expect(findDuplicateConnections([
      base({ id: 'a', institutionName: null }),
      base({ id: 'b', institutionName: '  ' }),
    ])).toEqual([]);
  });
});
