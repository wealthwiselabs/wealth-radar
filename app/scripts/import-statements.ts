/**
 * One-off: back-fill real per-account monthly history (Jan 2025→present) from
 * statement files, superseding any matching Plaid flows, then delete the
 * synthetic Legacy account.
 *
 * Usage:  npm run investments:import-statements -- <dir-of-statements> [flags]
 *
 *   --dry-run             resolve + report only; writes nothing, takes no snapshot
 *   --account <id>        route every statement to this account id, skipping
 *                         institution/mask resolution. For a directory covering one
 *                         account whose number changed mid-history (a platform
 *                         migration), where the old statements' mask matches nothing.
 *
 * Each PDF file is read to text, sent to Claude for structured extraction
 * (supporting multiple accounts per statement), and imported per account.
 * A file that fails reconciliation stops the run with the filename — fix
 * the input and re-run (idempotent).
 */
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { snapshotDb } from '@/lib/backup';
import { parseStatementExtraction, resolveStatementAccount, resolveOrCreateStatementAccount, importStatement, deleteLegacyAccount, isEmptyCloseoutStatement } from '@/lib/investments/statementBackfill';
import { schema } from '@/db/client';
import { isStatementFile } from '@/lib/investments/statementFiles';
import { extractStatement } from '@/lib/investments/statementExtract';

async function pdfToText(buf: Buffer): Promise<string> {
  // pdfjs-dist legacy build works under Node/tsx.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it: any) => ('str' in it ? it.str : '')).join(' ') + '\n';
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const accountIdx = argv.indexOf('--account');
  const forcedAccountId = accountIdx >= 0 ? argv[accountIdx + 1] : undefined;
  if (accountIdx >= 0 && !forcedAccountId) { console.error('--account requires an account id'); process.exit(1); }
  // Skip flags and the value consumed by --account (guard accountIdx >= 0, else
  // accountIdx + 1 === 0 would swallow a directory passed as the first argument).
  const dir = argv.find((a, i) => !a.startsWith('--') && !(accountIdx >= 0 && i === accountIdx + 1));
  if (!dir) { console.error('Usage: npm run investments:import-statements -- <dir> [--dry-run] [--account <id>]'); process.exit(1); }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('ANTHROPIC_API_KEY required'); process.exit(1); }

  const backup = dryRun ? null : snapshotDb('pre-statement-backfill');
  if (dryRun) console.log('DRY RUN — nothing will be written.');
  else console.log(backup ? `Snapshot: ${backup}` : 'No snapshot (in-memory db)');
  runMigrations();
  const db = getDb();
  const client = new Anthropic({ apiKey });

  if (forcedAccountId) {
    const target = db.select().from(schema.accounts).all().find((a) => a.id === forcedAccountId);
    if (!target) { console.error(`--account ${forcedAccountId} not found`); process.exit(1); }
    if (target.accountClass !== 'investment') { console.error(`--account ${forcedAccountId} is not an investment account`); process.exit(1); }
    console.log(`Forcing every statement into: ${target.institution} / ${target.name} (${target.mask ?? 'no mask'})`);
  }

  // .pdf only; skip 529 college-savings statements and the redundant annual report.
  const files = readdirSync(dir).filter(isStatementFile).sort();

  let ok = 0;
  const created: string[] = [];
  const mismatched: string[] = []; // committed value-authoritative (holdings didn't reconcile)
  const skipped: string[] = []; // zero-value close-out statements (see isEmptyCloseoutStatement)
  for (const f of files) {
    try {
      const text = await pdfToText(readFileSync(path.join(dir, f)));
      const accounts = parseStatementExtraction(await extractStatement(client, text));
      const parts: string[] = [];
      const seenAccountIds = new Set<string>();
      for (const s of accounts) {
        if (isEmptyCloseoutStatement(s)) {
          skipped.push(`${f} — ${s.accountRef.mask ?? s.accountRef.planName} @ ${s.asOf} (zero value, no holdings)`);
          parts.push(`${s.accountRef.mask ?? s.accountRef.planName} @ ${s.asOf}: SKIPPED close-out`);
          continue;
        }
        if (dryRun) {
          const found = forcedAccountId ? { accountId: forcedAccountId, name: '(forced)' } : resolveStatementAccount(s.accountRef, db);
          parts.push(`${s.accountRef.institution}/${s.accountRef.mask ?? s.accountRef.planName} @ ${s.asOf} $${s.reportedTotal.toLocaleString()} → ${found ? found.name : 'WOULD CREATE ACCOUNT'} (${s.holdings.length}h/${s.flows.length}f/${s.activity.length}a)`);
          continue;
        }
        const { accountId, created: made } = forcedAccountId
          ? { accountId: forcedAccountId, created: false }
          : resolveOrCreateStatementAccount(s.accountRef, db);
        if (seenAccountIds.has(accountId)) {
          throw new Error(`${f}: two accounts resolved to the same account ${accountId} — snapshots would overwrite`);
        }
        seenAccountIds.add(accountId);
        if (made) created.push(`${s.accountRef.institution} ${s.accountRef.planName ?? s.accountRef.mask ?? ''}`.trim());
        const res = await importStatement(s, accountId, db);
        if (!res.reconciled) mismatched.push(`${f} — ${s.accountRef.mask ?? s.accountRef.planName} @ ${s.asOf}`);
        parts.push(`${s.accountRef.mask ?? s.accountRef.planName} @ ${s.asOf}: ${res.flows}f/${res.superseded}s${res.reconciled ? '' : ' (value-authoritative)'}`);
      }
      ok += 1;
      console.log(`✓ ${f} → ${accounts.length} account(s): ${parts.join(' | ')}`);
    } catch (err) {
      throw new Error(`${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (dryRun) {
    console.log(`\nDRY RUN complete — ${ok}/${files.length} statements parsed, nothing written.`);
  } else {
    // Legacy cleanup belongs to the original full backfill, not a targeted re-import.
    const legacy = forcedAccountId ? { deleted: false } : deleteLegacyAccount(db);
    console.log(`Imported ${ok}/${files.length} statements.${forcedAccountId ? '' : ` Legacy ${legacy.deleted ? 'deleted' : 'not present'}.`}`);
  }
  if (created.length) console.log(`Created ${created.length} new account(s): ${[...new Set(created)].join(', ')}`);
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length} close-out statement(s):`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
  if (mismatched.length) {
    console.log(`\n${mismatched.length} statement(s) committed value-authoritative (holdings did not reconcile — review):`);
    for (const m of mismatched) console.log(`  - ${m}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
