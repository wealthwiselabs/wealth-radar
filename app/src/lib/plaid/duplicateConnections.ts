/**
 * Detect duplicate Plaid connections — two Items for the same institution and
 * owner, which a plain re-link creates. Pure (no db/network) so the client
 * ConnectionsPanel can call it on the /api/plaid/status list. `institution_id`
 * is not stored, so the key is (institution name, owner).
 */
export interface DupInput {
  id: string;
  institutionName: string | null;
  owner: string;
  status: string;
  needsInvestmentsConsent: boolean;
  lastSyncedAt: string | null;
}
export interface DuplicateGroup {
  key: string;
  institutionName: string | null;
  owner: string;
  itemIds: string[];
  recommendedKeepId: string;
}

const keyOf = (i: DupInput): string =>
  `${(i.institutionName ?? '').trim().toLowerCase()}|${i.owner}`;

/** Higher = healthier (better keep candidate). */
const health = (i: DupInput): number => {
  if (i.status === 'login_required' || i.status === 'error') return 0;
  if (i.needsInvestmentsConsent) return 1;
  return 2;
};

/** Pick the item to keep: healthiest, then most recently synced, then stable by id. */
function recommendKeep(items: DupInput[]): string {
  return [...items].sort((a, b) => {
    if (health(a) !== health(b)) return health(b) - health(a);
    const la = a.lastSyncedAt ?? '', lb = b.lastSyncedAt ?? '';
    if (la !== lb) return la < lb ? 1 : -1;   // later date first
    return a.id < b.id ? -1 : 1;
  })[0].id;
}

export function findDuplicateConnections(items: DupInput[]): DuplicateGroup[] {
  const byKey = new Map<string, DupInput[]>();
  for (const i of items) {
    // Skip items with null/empty institution name — we can't confidently match
    // unknown-institution items across potential duplicates.
    const trimmed = (i.institutionName ?? '').trim();
    if (!trimmed) continue;

    const k = keyOf(i);
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(i);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, members] of byKey) {
    if (members.length < 2) continue;
    groups.push({
      key,
      institutionName: members[0].institutionName,
      owner: members[0].owner,
      itemIds: members.map((m) => m.id),
      recommendedKeepId: recommendKeep(members),
    });
  }
  return groups;
}
