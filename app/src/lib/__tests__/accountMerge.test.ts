import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { mergeAccounts } from '@/lib/accountMerge';
import { accounts, transactions, statementImports, monthlyAggregates } from '@/db/schema';
import { transactionFingerprint } from '@/lib/fingerprint';
import { eq } from 'drizzle-orm';

const now = '2026-07-13T00:00:00.000Z';
function acct(db:any, id:string, name:string){ db.insert(accounts).values({ id, name, institution:'Amex', accountClass:'spending', type:'credit', origin:'manual', status:'active', createdAt:now, modifiedAt:now }).run(); }
function tx(db:any, o:any){ db.insert(transactions).values({ id:o.id, accountId:o.accountId, date:o.date, month:o.date.slice(0,7), description:o.desc, amount:o.amount, categoryId:'food', subcategoryId:'x', note:'', source:'pdf', fingerprint: transactionFingerprint({accountId:o.accountId, date:o.date, description:o.desc, amount:o.amount}), pending:false, createdAt:now, modifiedAt:now }).run(); }

describe('mergeAccounts', () => {
  it('re-points transactions, recomputes fingerprint, recomputes aggregates, deletes source', async () => {
    const { db } = makeTmpDb();
    acct(db,'A','Green Card (Credit Card)'); acct(db,'B','Green Card Credit Card');
    tx(db,{id:'a1',accountId:'A',date:'2026-01-10',desc:'STARBUCKS',amount:-5});
    tx(db,{id:'b1',accountId:'B',date:'2026-02-10',desc:'UBER',amount:-8});
    db.insert(statementImports).values({ id:'s1', accountId:'B', month:'2026-02', sourceFile:'feb.pdf', importedAt:now }).run();

    const res = mergeAccounts('A', ['B'], db);
    expect(res.mergedAccounts).toBe(1);
    expect(res.reassigned).toBe(1);
    expect(db.select().from(accounts).all()).toHaveLength(1);          // B gone
    const bTx = db.select().from(transactions).where(eq(transactions.id,'b1')).get()!;
    expect(bTx.accountId).toBe('A');
    expect(bTx.fingerprint).toBe(transactionFingerprint({accountId:'A',date:'2026-02-10',description:'UBER',amount:-8})); // recomputed for A
    expect(db.select().from(statementImports).where(eq(statementImports.accountId,'A')).all()).toHaveLength(1);
    expect(db.select().from(monthlyAggregates).where(eq(monthlyAggregates.accountId,'A')).all().length).toBeGreaterThan(0);
  });

  it('drops an exact duplicate but keeps distinct rows', async () => {
    const { db } = makeTmpDb();
    acct(db,'A','X'); acct(db,'B','Y');
    tx(db,{id:'a1',accountId:'A',date:'2026-01-10',desc:'DUP',amount:-5});
    tx(db,{id:'b1',accountId:'B',date:'2026-01-10',desc:'DUP',amount:-5});   // same date/desc/amount → dup once on A
    tx(db,{id:'b2',accountId:'B',date:'2026-01-11',desc:'KEEP',amount:-9});
    const res = mergeAccounts('A', ['B'], db);
    expect(res.deduped).toBe(1);
    const all = db.select().from(transactions).all();
    expect(all.filter(t=>t.description==='DUP')).toHaveLength(1);
    expect(all.filter(t=>t.description==='KEEP')).toHaveLength(1);
  });

  it('preserves within-source distinct rows that share a fingerprint', async () => {
    const { db } = makeTmpDb();
    acct(db,'A','X'); acct(db,'B','Y');
    // Two genuinely-distinct source rows with identical date/desc/amount → same fingerprint.
    tx(db,{id:'b1',accountId:'B',date:'2026-03-10',desc:'SAME',amount:-7});
    tx(db,{id:'b2',accountId:'B',date:'2026-03-10',desc:'SAME',amount:-7});
    const res = mergeAccounts('A', ['B'], db);
    expect(res.deduped).toBe(0);
    const onA = db.select().from(transactions).where(eq(transactions.accountId,'A')).all();
    expect(onA).toHaveLength(2);   // both survive on A
    expect(res.reassigned).toBe(2);
  });

  it('drops a source row whose externalId already exists on the target', async () => {
    const { db } = makeTmpDb();
    acct(db,'A','X'); acct(db,'B','Y');
    // Target row with externalId 'x'.
    db.insert(transactions).values({ id:'a1', accountId:'A', date:'2026-04-01', month:'2026-04', description:'TGT', amount:-3, categoryId:'food', subcategoryId:'x', note:'', source:'plaid', externalId:'x', fingerprint: transactionFingerprint({accountId:'A',date:'2026-04-01',description:'TGT',amount:-3}), pending:false, createdAt:now, modifiedAt:now }).run();
    // Source row with the SAME externalId 'x' but a different fingerprint.
    db.insert(transactions).values({ id:'b1', accountId:'B', date:'2026-04-02', month:'2026-04', description:'SRC', amount:-9, categoryId:'food', subcategoryId:'x', note:'', source:'plaid', externalId:'x', fingerprint: transactionFingerprint({accountId:'B',date:'2026-04-02',description:'SRC',amount:-9}), pending:false, createdAt:now, modifiedAt:now }).run();
    const res = mergeAccounts('A', ['B'], db);
    expect(res.deduped).toBe(1);
    const withX = db.select().from(transactions).where(eq(transactions.externalId,'x')).all();
    expect(withX).toHaveLength(1);   // only one row with externalId 'x' remains, no throw
  });

  it('throws on unknown or self-merge', async () => {
    const { db } = makeTmpDb(); acct(db,'A','X');
    expect(()=>mergeAccounts('A',['A'],db)).toThrow();
    expect(()=>mergeAccounts('A',['nope'],db)).toThrow();
  });

  it('carries plaid identity from a plaid source onto a pdf target', async () => {
    const { db } = makeTmpDb();
    db.insert(accounts).values({
      id: 'PDF', name: 'Freedom Unlimited', institution: 'Chase', owner: 'Alex',
      accountClass: 'spending', type: 'credit', origin: 'manual', status: 'active',
      createdAt: now, modifiedAt: now,
    }).run();
    db.insert(accounts).values({
      id: 'PLAID', name: 'Card', institution: 'Chase', owner: 'Alex', mask: '3128',
      accountClass: 'spending', type: 'credit', subtype: 'credit card', origin: 'plaid',
      plaidItemId: 'item-1', plaidAccountId: 'pa-3128', status: 'active',
      createdAt: now, modifiedAt: now,
    }).run();

    mergeAccounts('PDF', ['PLAID'], db);

    const t = db.select().from(accounts).where(eq(accounts.id, 'PDF')).get()!;
    expect(t.plaidAccountId).toBe('pa-3128');   // else the next sync recreates the account
    expect(t.plaidItemId).toBe('item-1');
    expect(t.mask).toBe('3128');
    expect(t.subtype).toBe('credit card');
    expect(t.origin).toBe('plaid');
  });

  it('merges when adopting the donor mask would collide with the source row', async () => {
    const { db } = makeTmpDb();
    // Same owner/institution/name on both sides; only the mask differs (the PDF
    // row has none). Carrying the donor's mask onto the target makes the two
    // rows identical under the unique index, so the target must not be updated
    // until the source row is gone.
    db.insert(accounts).values({
      id: 'PDF', name: 'Delta', institution: 'Amex', owner: 'Alex', mask: null,
      accountClass: 'spending', type: 'credit', origin: 'manual', status: 'active',
      createdAt: now, modifiedAt: now,
    }).run();
    db.insert(accounts).values({
      id: 'PLAID', name: 'Delta', institution: 'Amex', owner: 'Alex', mask: '3108',
      accountClass: 'spending', type: 'credit', origin: 'plaid', plaidAccountId: 'pa-3108',
      status: 'active', createdAt: now, modifiedAt: now,
    }).run();
    tx(db, { id: 'p1', accountId: 'PDF', date: '2026-03-17', desc: 'DELTA AIR', amount: -120 });
    tx(db, { id: 'q1', accountId: 'PLAID', date: '2026-05-01', desc: 'SPOTIFY', amount: -12 });

    expect(() => mergeAccounts('PDF', ['PLAID'], db)).not.toThrow();

    const rows = db.select().from(accounts).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('PDF');
    expect(rows[0].mask).toBe('3108');
    expect(rows[0].plaidAccountId).toBe('pa-3108');
    expect(db.select().from(transactions).all()).toHaveLength(2);
  });

  it('refuses to merge two live plaid accounts', async () => {
    const { db } = makeTmpDb();
    for (const [id, pa] of [['A', 'pa-1'], ['B', 'pa-2']]) {
      db.insert(accounts).values({
        id, name: 'Card', institution: 'Chase', owner: 'Alex', mask: id === 'A' ? '3109' : '3112',
        accountClass: 'spending', type: 'credit', origin: 'plaid', plaidAccountId: pa,
        status: 'active', createdAt: now, modifiedAt: now,
      }).run();
    }
    expect(() => mergeAccounts('A', ['B'], db)).toThrow(/plaid/i);
  });

  it('clears closedAtMonth when any merged account is still open', async () => {
    const { db } = makeTmpDb();
    db.insert(accounts).values({
      id: 'T', name: 'Sapphire', institution: 'Chase', owner: 'Alex',
      accountClass: 'spending', type: 'credit', origin: 'manual', status: 'active',
      closedAtMonth: '2026-04', createdAt: now, modifiedAt: now,
    }).run();
    db.insert(accounts).values({
      id: 'S', name: 'Card', institution: 'Chase', owner: 'Alex', mask: '3124',
      accountClass: 'spending', type: 'credit', origin: 'plaid', plaidAccountId: 'pa-3124',
      status: 'active', closedAtMonth: null,
      createdAt: now, modifiedAt: now,
    }).run();

    mergeAccounts('T', ['S'], db);

    const t = db.select().from(accounts).where(eq(accounts.id, 'T')).get()!;
    expect(t.closedAtMonth).toBeNull();         // one side is still open
  });
});
