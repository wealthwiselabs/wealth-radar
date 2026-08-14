import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { proposeMerges, canonicalAccount } from '@/lib/accountName';
import { mergeAccounts } from '@/lib/accountMerge';

runMigrations();
const db = getDb();
const rows = () => db.select({
  id: schema.accounts.id, institution: schema.accounts.institution, name: schema.accounts.name,
  type: schema.accounts.type, subtype: schema.accounts.subtype,
  txnCount: sql<number>`(select count(*) from transactions t where t.account_id = ${schema.accounts.id})`,
}).from(schema.accounts).all();

const apply = process.argv.includes('--apply');

// 1) Merge duplicate clusters.
const proposals = proposeMerges(rows() as any);
if (proposals.length === 0) console.log('No duplicate account clusters found.');
else {
  console.log(`${proposals.length} merge proposal(s):`);
  for (const p of proposals) {
    console.log(`\n  → ${p.canonical.institution} ${p.canonical.name}  (target ${p.targetId})`);
    for (const n of p.names) console.log(`     ${n}`);
  }
  if (apply) for (const p of proposals) {
    const r = mergeAccounts(p.targetId, p.sourceIds, db);
    console.log(`merged ${r.mergedAccounts} → ${p.targetId} (reassigned ${r.reassigned}, deduped ${r.deduped})`);
  }
}

// 2) Canonicalize every remaining account's display name (skip a rename that would
//    collide with another account's existing (institution,name) — the merge pass
//    should have collapsed those, but guard anyway to avoid a UNIQUE violation).
console.log('\nName canonicalizations:');
const taken = new Set(db.select().from(schema.accounts).all().map((a) => `${a.institution}|${a.name}`));
for (const a of db.select().from(schema.accounts).all()) {
  // A user-assigned name cannot be re-derived (Chase reports every card as
  // "CREDIT CARD"), so canonicalizing it would destroy the only copy.
  if (a.nameSource === 'user') {
    console.log(`  "${a.institution} / ${a.name}"  →  [SKIP: user-assigned name]`);
    continue;
  }
  const c = canonicalAccount(a.institution, a.name, { type: a.type, subtype: a.subtype ?? undefined });
  if (c.institution === a.institution && c.name === a.name) continue;
  const collides = taken.has(`${c.institution}|${c.name}`);
  console.log(`  "${a.institution} / ${a.name}"  →  "${c.institution} ${c.name}"${collides ? '  [SKIP: name taken]' : ''}`);
  if (apply && !collides) {
    db.update(schema.accounts).set({ institution: c.institution, name: c.name, modifiedAt: new Date().toISOString() })
      .where(eq(schema.accounts.id, a.id)).run();
    taken.delete(`${a.institution}|${a.name}`);
    taken.add(`${c.institution}|${c.name}`);
  }
}
console.log(apply ? '\nApplied.' : '\nDry run. Re-run with --apply to merge + rename.');
