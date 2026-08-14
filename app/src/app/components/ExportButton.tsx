'use client';

import { useState } from 'react';
import type { ExportFormat } from '@/types';

interface ExportButtonProps {
  dateRange: { startDate: string; endDate: string };
}

export default function ExportButton({ dateRange }: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true);

    try {
      const params = new URLSearchParams({ format });
      if (dateRange.startDate) params.append('startDate', dateRange.startDate);
      if (dateRange.endDate) params.append('endDate', dateRange.endDate);

      const response = await fetch(`/api/export?${params}`);

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Get filename from header or generate one
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || `transactions.${format}`;

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export transactions');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="relative inline-block">
      <div className="flex rounded-[var(--radius-2)] border border-[var(--color-border-base-default)] overflow-hidden">
        <button
          onClick={() => handleExport('csv')}
          disabled={isExporting}
          className="px-[var(--space-3)] py-[var(--space-2)] text-small bg-[var(--color-background-base-default)] text-[var(--color-text-base-default)] hover:bg-[var(--color-background-base-hover)] disabled:opacity-50 flex items-center gap-[var(--space-2)]"
        >
          <svg className="w-4 h-4 text-[var(--color-icon-base-default)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          CSV
        </button>
        <button
          onClick={() => handleExport('json')}
          disabled={isExporting}
          className="px-[var(--space-3)] py-[var(--space-2)] text-small bg-[var(--color-background-base-default)] text-[var(--color-text-base-default)] hover:bg-[var(--color-background-base-hover)] disabled:opacity-50 border-l border-[var(--color-border-base-default)] flex items-center gap-[var(--space-2)]"
        >
          <svg className="w-4 h-4 text-[var(--color-icon-base-default)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          JSON
        </button>
      </div>
    </div>
  );
}
