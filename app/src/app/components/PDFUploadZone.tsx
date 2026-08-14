'use client';

import { useState, useCallback, useRef } from 'react';
import { extractTextFromPDF } from '@/lib/pdfExtractor';
import { getStoredApiKey } from '@/lib/apiKey';
import {
  pdfsFromDataTransfer,
  pdfsFromFileList,
  runWithConcurrency,
} from '@/lib/pdfBatch';
import { classifyStatementType } from '@/lib/investments/detectStatement';
import type { ParsedStatement, PlanEntry } from '@/lib/investments/statementBackfill';
import type { ClassifyResponse, PendingTransaction } from '@/types';

const CONCURRENCY = 3;

type FileStatus = 'pending' | 'extracting' | 'classifying' | 'done' | 'error';

export interface StatementPreview {
  fileName: string;
  statements: ParsedStatement[];
  plan: PlanEntry[];
}

interface FileProgress {
  name: string;
  status: FileStatus;
  count?: number;
  error?: string;
  kind?: 'bank' | 'investment';
}

interface PDFUploadZoneProps {
  onTransactionsClassified: (
    transactions: PendingTransaction[]
  ) => void;
  onStatementsPreviewed: (previews: StatementPreview[]) => void;
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
}

// Allow webkitdirectory on the directory file input (TS doesn't know about it).
declare module 'react' {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

export default function PDFUploadZone({
  onTransactionsClassified,
  onStatementsPreviewed,
  isProcessing,
  setIsProcessing,
}: PDFUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<FileProgress[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const updateProgress = useCallback((index: number, patch: Partial<FileProgress>) => {
    setProgress((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }, []);

  type OneResult =
    | { kind: 'bank'; transactions: PendingTransaction[] }
    | { kind: 'investment'; preview: StatementPreview };

  const processOne = useCallback(
    async (file: File, index: number, apiKey: string): Promise<OneResult> => {
      try {
        updateProgress(index, { status: 'extracting' });
        const pdfText = await extractTextFromPDF(file);
        if (!pdfText.trim()) throw new Error('Could not extract text (PDF may be scanned/image-based)');

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['x-anthropic-api-key'] = apiKey;
        updateProgress(index, { status: 'classifying' });

        if (classifyStatementType(pdfText) === 'investment') {
          const response = await fetch('/api/investments/import-statement/preview', {
            method: 'POST', headers, body: JSON.stringify({ pdfText, fileName: file.name }),
          });
          if (!response.ok) {
            const e = await response.json().catch(() => ({}));
            throw new Error(e.error || `Statement preview failed (${response.status})`);
          }
          const preview = (await response.json()) as StatementPreview;
          updateProgress(index, { status: 'done', count: preview.plan.length, kind: 'investment' });
          return { kind: 'investment', preview };
        }

        const response = await fetch('/api/classify', {
          method: 'POST', headers, body: JSON.stringify({ pdfText, fileName: file.name }),
        });
        if (!response.ok) {
          const e = await response.json().catch(() => ({}));
          throw new Error(e.error || `Classification failed (${response.status})`);
        }
        const result: ClassifyResponse = await response.json();
        updateProgress(index, { status: 'done', count: result.transactions.length, kind: 'bank' });
        return { kind: 'bank', transactions: result.transactions };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to process PDF';
        updateProgress(index, { status: 'error', error: message });
        return { kind: 'bank', transactions: [] };
      }
    },
    [updateProgress],
  );

  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        setError('No PDF files found');
        return;
      }

      setError(null);
      setIsProcessing(true);
      setProgress(files.map((f) => ({ name: f.name, status: 'pending' })));

      const apiKey = getStoredApiKey();

      const allResults = await runWithConcurrency(files, CONCURRENCY, (file, i) =>
        processOne(file, i, apiKey)
      );
      setIsProcessing(false);

      const bankTxns = allResults.flatMap((r) => (r.kind === 'bank' ? r.transactions : []));
      const previews = allResults.flatMap((r) => (r.kind === 'investment' ? [r.preview] : []));

      if (bankTxns.length === 0 && previews.length === 0) {
        setError('No transactions or investment holdings found across the imported PDFs');
        return;
      }
      if (bankTxns.length > 0) onTransactionsClassified(bankTxns);
      if (previews.length > 0) onStatementsPreviewed(previews);
    },
    [onTransactionsClassified, onStatementsPreviewed, processOne, setIsProcessing]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = await pdfsFromDataTransfer(e.dataTransfer);
      processFiles(files);
    },
    [processFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = pdfsFromFileList(e.target.files);
      processFiles(files);
      e.target.value = '';
    },
    [processFiles]
  );

  const handleFolderSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = pdfsFromFileList(e.target.files);
      processFiles(files);
      e.target.value = '';
    },
    [processFiles]
  );

  const total = progress.length;
  const finished = progress.filter((p) => p.status === 'done' || p.status === 'error').length;

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        onChange={handleFolderSelect}
        className="hidden"
      />

      <div
        onDrop={!isProcessing ? handleDrop : undefined}
        onDragOver={!isProcessing ? handleDragOver : undefined}
        onDragLeave={handleDragLeave}
        className={`
          relative border-2 border-dashed rounded-[var(--radius-3)] p-[var(--space-8)] text-center transition-all
          ${isDragging ? 'border-[var(--color-border-brand)] bg-[var(--color-background-brand-subdued)]' : 'border-[var(--color-border-base-default)]'}
          ${isProcessing ? 'opacity-75' : 'hover:border-[var(--color-border-brand)] hover:bg-[var(--color-background-base-hover)]'}
        `}
      >
        {isProcessing && total > 0 ? (
          <div className="flex flex-col items-center gap-[var(--space-3)]">
            <div className="w-10 h-10 border-4 border-[var(--color-background-brand-default)] border-t-transparent rounded-full animate-spin" />
            <p className="text-medium text-[var(--color-text-base-subdued)]">
              Processing {finished} of {total} PDFs…
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-[var(--space-3)]">
            <svg
              className="w-12 h-12 text-[var(--color-icon-base-subdued)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <div>
              <p className="text-large font-medium text-[var(--color-text-base-default)]">
                Drop a PDF or a folder of PDFs here
              </p>
              <p className="text-small text-[var(--color-text-base-subdued)] mt-[var(--space-1)]">
                or pick from disk
              </p>
            </div>
            <div className="flex gap-[var(--space-2)] mt-[var(--space-2)]">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="origin-btn origin-btn-secondary"
                disabled={isProcessing}
              >
                Pick PDFs
              </button>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="origin-btn origin-btn-secondary"
                disabled={isProcessing}
              >
                Pick Folder
              </button>
            </div>
          </div>
        )}
      </div>

      {progress.length > 0 && (
        <div className="mt-[var(--space-4)] origin-card overflow-hidden">
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-small">
              <tbody>
                {progress.map((p, i) => (
                  <tr
                    key={i}
                    className="border-t border-[var(--color-border-base-subdued)] first:border-t-0"
                  >
                    <td className="py-[var(--space-2)] px-[var(--space-3)] text-[var(--color-text-base-default)] truncate max-w-md">
                      {p.name}
                    </td>
                    <td className="py-[var(--space-2)] px-[var(--space-3)] text-right whitespace-nowrap">
                      <StatusPill p={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-[var(--space-4)] p-[var(--space-3)] bg-[var(--color-background-critical-subdued)] border border-[var(--color-border-critical)] rounded-[var(--radius-2)]">
          <p className="text-small text-[var(--color-text-critical)]">{error}</p>
        </div>
      )}
    </div>
  );
}

function StatusPill({ p }: { p: FileProgress }) {
  const base = 'text-xsmall px-[var(--space-2)] py-[var(--space-1)] rounded-[var(--radius-1)]';
  switch (p.status) {
    case 'pending':
      return (
        <span className={`${base} bg-[var(--color-background-base-subdued)] text-[var(--color-text-base-subdued)]`}>
          queued
        </span>
      );
    case 'extracting':
      return (
        <span className={`${base} bg-[var(--color-background-info-subdued)] text-[var(--color-text-base-default)]`}>
          extracting…
        </span>
      );
    case 'classifying':
      return (
        <span className={`${base} bg-[var(--color-background-info-subdued)] text-[var(--color-text-base-default)]`}>
          classifying…
        </span>
      );
    case 'done':
      return (
        <span className={`${base} bg-[var(--color-background-success-subdued)] text-[var(--color-text-success)]`}>
          ✓ {p.count ?? 0} {p.kind === 'investment' ? 'account(s)' : 'transactions'}
        </span>
      );
    case 'error':
      return (
        <span
          className={`${base} bg-[var(--color-background-critical-subdued)] text-[var(--color-text-critical)]`}
          title={p.error}
        >
          ✗ {p.error || 'error'}
        </span>
      );
  }
}
