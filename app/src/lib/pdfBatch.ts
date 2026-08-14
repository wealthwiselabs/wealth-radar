// Helpers for batch-importing PDFs from a folder drop or a folder picker.

import { isPDF } from './pdfExtractor';

// Recursively walk a FileSystemEntry (from a drag-and-drop folder) and collect PDFs.
async function readEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((res, rej) =>
      fileEntry.file(res, rej)
    );
    if (isPDF(file)) out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    // readEntries only returns a chunk at a time; loop until empty.
    while (true) {
      const chunk: FileSystemEntry[] = await new Promise((res, rej) =>
        reader.readEntries(res, rej)
      );
      if (chunk.length === 0) break;
      for (const e of chunk) {
        await readEntry(e, out);
      }
    }
  }
}

// Extract PDF files from a DataTransfer (drop event), traversing any dropped folders.
export async function pdfsFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];

  // Prefer items[] so we can detect folders via webkitGetAsEntry.
  if (dt.items && dt.items.length > 0) {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      for (const entry of entries) await readEntry(entry, out);
      return out;
    }
  }

  // Fallback: plain files (no folder traversal possible).
  if (dt.files) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files[i];
      if (isPDF(f)) out.push(f);
    }
  }
  return out;
}

// Extract PDFs from a file-input FileList (e.g. <input webkitdirectory>).
export function pdfsFromFileList(list: FileList | null): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (isPDF(f)) out.push(f);
  }
  return out;
}

// Run an async task per item with a concurrency cap.
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await task(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}
