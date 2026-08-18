// Import bank-statement PDFs straight from the chat panel's attach button,
// reusing the same pipeline as the full import UI: extract text → classify via
// /api/classify → commit via /api/transactions. Investment statements need the
// preview→confirm flow, so they are detected and routed to a note rather than
// silently mis-imported.

import { extractTextFromPDF } from '@/lib/pdfExtractor';
import { classifyStatementType } from '@/lib/investments/detectStatement';
import { runWithConcurrency } from '@/lib/pdfBatch';
import type { ClassifyResponse, PendingTransaction } from '@/types';

const CONCURRENCY = 3;

export interface ChatImportSummary {
  /** Transactions actually saved (duplicates excluded). */
  importedCount: number;
  /** Duplicates the server skipped. */
  skippedCount: number;
  /** Bank statements that yielded at least one transaction. */
  bankFiles: string[];
  /** Files detected as investment statements — not handled by chat import. */
  investmentFiles: string[];
  /** Per-file failures (extract/classify errors). */
  errors: { file: string; message: string }[];
}

type PerFile =
  | { file: string; kind: 'bank'; transactions: PendingTransaction[] }
  | { file: string; kind: 'investment' }
  | { file: string; kind: 'error'; message: string };

async function classifyOne(file: File, apiKey: string): Promise<PerFile> {
  try {
    const pdfText = await extractTextFromPDF(file);
    if (!pdfText.trim()) {
      throw new Error('could not extract text (scanned or image-only PDF?)');
    }
    if (classifyStatementType(pdfText) === 'investment') {
      return { file: file.name, kind: 'investment' };
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-anthropic-api-key'] = apiKey;
    const res = await fetch('/api/classify', {
      method: 'POST',
      headers,
      body: JSON.stringify({ pdfText, fileName: file.name }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `classification failed (${res.status})`);
    }
    const result = (await res.json()) as ClassifyResponse;
    return { file: file.name, kind: 'bank', transactions: result.transactions };
  } catch (err) {
    return {
      file: file.name,
      kind: 'error',
      message: err instanceof Error ? err.message : 'failed to process PDF',
    };
  }
}

/**
 * Parse-only variant of {@link importPdfsViaChat}: extract → classify every PDF,
 * but DO NOT commit anything. Bank statements come back as staged rows for the
 * chat panel to hold until the user asks the agent to import them (via the gated
 * `import_statement` tool). Investment statements can't be staged this way, so
 * they are surfaced as errors pointing at the full Import panel.
 */
export async function parsePdfsViaChat(
  files: File[],
  apiKey: string,
): Promise<{
  staged: { fileName: string; transactions: PendingTransaction[] }[];
  errors: { file: string; message: string }[];
}> {
  const perFile = await runWithConcurrency(files, CONCURRENCY, (f) => classifyOne(f, apiKey));

  const staged = perFile
    .filter((r): r is Extract<PerFile, { kind: 'bank' }> => r.kind === 'bank')
    .map((r) => ({ fileName: r.file, transactions: r.transactions }));

  const errors: { file: string; message: string }[] = [];
  for (const r of perFile) {
    if (r.kind === 'error') errors.push({ file: r.file, message: r.message });
    else if (r.kind === 'investment')
      errors.push({ file: r.file, message: 'investment statements import via the Import panel' });
  }

  return { staged, errors };
}

/** Classify every PDF, then commit all bank transactions in one save. */
export async function importPdfsViaChat(
  files: File[],
  apiKey: string,
): Promise<ChatImportSummary> {
  const perFile = await runWithConcurrency(files, CONCURRENCY, (f) => classifyOne(f, apiKey));

  const bank = perFile.filter((r): r is Extract<PerFile, { kind: 'bank' }> => r.kind === 'bank');
  const allTxns = bank.flatMap((r) => r.transactions);
  const errors = perFile
    .filter((r): r is Extract<PerFile, { kind: 'error' }> => r.kind === 'error')
    .map((r) => ({ file: r.file, message: r.message }));
  const investmentFiles = perFile.filter((r) => r.kind === 'investment').map((r) => r.file);

  let importedCount = 0;
  let skippedCount = 0;
  if (allTxns.length > 0) {
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: allTxns }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `saving transactions failed (${res.status})`);
    }
    const data = await res.json();
    importedCount = data.transactions?.length ?? allTxns.length;
    skippedCount = data.skipped ?? 0;
  }

  return {
    importedCount,
    skippedCount,
    bankFiles: bank.filter((r) => r.transactions.length > 0).map((r) => r.file),
    investmentFiles,
    errors,
  };
}

/** A human-readable, markdown-friendly summary for the chat transcript. */
export function formatImportSummary(s: ChatImportSummary): string {
  const parts: string[] = [];

  if (s.importedCount > 0) {
    const where =
      s.bankFiles.length === 1 ? `**${s.bankFiles[0]}**` : `${s.bankFiles.length} statements`;
    const n = s.importedCount;
    let line = `Imported **${n}** transaction${n === 1 ? '' : 's'} from ${where}.`;
    if (s.skippedCount > 0) {
      line += ` ${s.skippedCount} duplicate${s.skippedCount === 1 ? '' : 's'} skipped.`;
    }
    parts.push(line);
  } else if (s.errors.length === 0 && s.investmentFiles.length === 0) {
    parts.push('No transactions found in the selected PDF(s).');
  }

  if (s.investmentFiles.length > 0) {
    const n = s.investmentFiles.length;
    parts.push(
      `${n} investment statement${n === 1 ? '' : 's'} (${s.investmentFiles.join(', ')}) ` +
        `${n === 1 ? "wasn't" : "weren't"} imported here — use the Import panel for those.`,
    );
  }

  for (const e of s.errors) parts.push(`⚠️ Couldn't read ${e.file}: ${e.message}`);

  return parts.join('\n\n');
}
