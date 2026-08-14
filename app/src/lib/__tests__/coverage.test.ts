import { describe, it, expect } from 'vitest';
import { makeTmpDb } from '@/test/tmpDb';
import { computeCoverage, monthsWindow, earliestEvidenceMonth } from '@/lib/coverage';
import { accounts, statementImports, transactions, plaidItems } from '@/db/schema';

const now = '2026-07-14T00:00:00.000Z';
const T = '2026-07-14T00:00:00.000Z';
function acct(db:any, o:any){ db.insert(accounts).values({ id:o.id, name:o.name, institution:o.inst, owner:o.owner??'', mask:o.mask??null, accountClass:o.cls??'spending', type:'credit', origin:o.origin??'manual', status:o.status??'active', closedAtMonth:o.closedAt??null, plaidItemId:o.plaidItemId??null, createdAt:T, modifiedAt:T }).run(); }
function stmt(db:any, id:string, acctId:string, month:string){ db.insert(statementImports).values({ id, accountId:acctId, month, sourceFile:'x.pdf', importedAt:T }).run(); }
// The active-from month is derived from the earliest evidence, so a test that
// needs an account 'live' from a given month seeds a transaction in it.
function tx(db:any, id:string, acctId:string, month:string){ db.insert(transactions).values({ id, accountId:acctId, date:`${month}-05`, month, description:'x', amount:-1, categoryId:'', subcategoryId:'', note:'', source:'pdf', fingerprint:id, pending:false, createdAt:T, modifiedAt:T }).run(); }

describe('coverage', () => {
  it('monthsWindow returns N recent months ending at now, oldest→newest', () => {
    expect(monthsWindow('2026-07-14T00:00:00Z', 3)).toEqual(['2026-05','2026-06','2026-07']);
  });

  it('PDF account: covered months present, missing months flagged, na outside active range', () => {
    const { db } = makeTmpDb();
    acct(db, { id:'a', inst:'Chase', name:'Sapphire' });
    stmt(db,'s1','a','2026-05'); stmt(db,'s2','a','2026-07');   // 06 missing
    const cov = computeCoverage({ monthsBack: 4, now }, db);
    const row = cov.accounts.find(r => r.accountId==='a')!;
    const cell = (m:string) => row.cells.find(c=>c.month===m)!.state;
    expect(cell('2026-04')).toBe('na');       // before activeFrom
    expect(cell('2026-05')).toBe('covered');
    expect(cell('2026-06')).toBe('missing');
    expect(cell('2026-07')).toBe('covered');
    expect(cov.gaps.some(g=>g.accountId==='a' && g.month==='2026-06')).toBe(true);
  });

  it('closed account: months after closedAtMonth are na (no gaps)', () => {
    const { db } = makeTmpDb();
    acct(db, { id:'a', inst:'Amex', name:'Green', status:'closed', closedAt:'2026-05' });
    stmt(db,'s1','a','2026-05');
    const cov = computeCoverage({ monthsBack: 4, now }, db);
    const row = cov.accounts.find(r=>r.accountId==='a')!;
    expect(row.cells.find(c=>c.month==='2026-06')!.state).toBe('na');
    expect(row.cells.find(c=>c.month==='2026-07')!.state).toBe('na');
    expect(cov.gaps.filter(g=>g.accountId==='a')).toHaveLength(0);   // closed → no nagging
  });

  it('Plaid account: covered up to syncedThroughMonth when healthy; missing beyond', () => {
    const { db } = makeTmpDb();
    db.insert(plaidItems).values({ id:'it1', plaidItemId:'p', accessToken:'x', status:'healthy', syncedThroughMonth:'2026-06', createdAt:T, modifiedAt:T }).run();
    acct(db, { id:'a', inst:'Chase', name:'Checking', origin:'plaid', plaidItemId:'it1' });
    tx(db,'t1','a','2026-05');   // evidence: account is live from 2026-05
    const cov = computeCoverage({ monthsBack: 4, now }, db);
    const row = cov.accounts.find(r=>r.accountId==='a')!;
    expect(row.cells.find(c=>c.month==='2026-06')!.state).toBe('covered');
    expect(row.cells.find(c=>c.month==='2026-07')!.state).toBe('missing');   // beyond syncedThrough
  });

  it('groups rows by owner, keeps gap-priority within a person, and sorts unassigned last', () => {
    const { db } = makeTmpDb();
    // Sam's account has NO gaps; Alex's have gaps. Under a purely
    // gap-first sort Alex would be split around Sam — owner must win.
    acct(db, { id:'x1', inst:'Chase', name:'IHG', owner:'Sam' });
    stmt(db,'sx1','x1','2026-05'); stmt(db,'sx2','x1','2026-06'); stmt(db,'sx3','x1','2026-07');
    acct(db, { id:'s1', inst:'Chase', name:'Sapphire', owner:'Alex' });
    tx(db,'ts1','s1','2026-05');                       // live from 05, no statements → 3 gaps
    acct(db, { id:'s2', inst:'Amex', name:'Platinum', owner:'Alex' });
    stmt(db,'ss2','s2','2026-05');                     // live from 05, 05 covered → 2 gaps
    acct(db, { id:'u1', inst:'US Bank', name:'Card', owner:'' });
    tx(db,'tu1','u1','2026-05');

    const cov = computeCoverage({ monthsBack: 3, now }, db);
    const owners = cov.accounts.map(r => r.owner);
    expect(owners).toEqual(['Alex', 'Alex', 'Sam', '']);   // unassigned last

    // Within Alex, the account with more missing months comes first.
    const alex = cov.accounts.filter(r => r.owner === 'Alex');
    expect(alex[0].accountId).toBe('s1');
    expect(alex[1].accountId).toBe('s2');
  });

  it('display name includes the owner', () => {
    const { db } = makeTmpDb();
    acct(db, { id:'a', inst:'Chase', name:'Freedom', owner:'Alex' });
    const cov = computeCoverage({ monthsBack: 2, now }, db);
    expect(cov.accounts[0].display).toBe('Alex Chase Freedom');
  });

  it('disambiguates two same-product cards by mask in the display', () => {
    const { db } = makeTmpDb();
    acct(db, { id:'a', inst:'Chase', name:'Freedom', owner:'Alex', mask:'3128' });
    acct(db, { id:'b', inst:'Chase', name:'Freedom', owner:'Alex', mask:'3119' });
    const cov = computeCoverage({ monthsBack: 2, now }, db);
    const displays = cov.accounts.map(r => r.display).sort();
    expect(displays).toEqual(['Alex Chase Freedom · 3119', 'Alex Chase Freedom · 3128']);
  });

  it('earliestEvidenceMonth falls back to transactions when no statements', () => {
    const { db } = makeTmpDb();
    acct(db, { id:'a', inst:'Chase', name:'Sapphire' });
    db.insert(transactions).values({ id:'t', accountId:'a', date:'2026-03-10', month:'2026-03', description:'x', amount:-1, categoryId:'', subcategoryId:'', note:'', source:'pdf', fingerprint:'f', pending:false, createdAt:T, modifiedAt:T }).run();
    expect(earliestEvidenceMonth('a', db)).toBe('2026-03');
  });
});
