'use client';

import { useEffect, useState } from 'react';
import type { CoverageResult } from '@/lib/coverage';
import { onDataChanged } from '@/lib/dataEvents';

interface GapsBadgeProps {
  /** Called when the badge is clicked so the host page can scroll to / reveal the coverage grid. */
  onOpen: () => void;
  /** Bump this (e.g. after a sync or account change) to force a refetch. */
  refreshKey?: number;
}

export default function GapsBadge({ onOpen, refreshKey }: GapsBadgeProps) {
  const [gapCount, setGapCount] = useState(0);
  const [tick, setTick] = useState(0);

  // The actions that change coverage happen on pages, not in the header.
  useEffect(() => onDataChanged(() => setTick((t) => t + 1)), []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/coverage')
      .then((res) => (res.ok ? res.json() : null))
      .then((json: CoverageResult | null) => {
        if (!cancelled && json) setGapCount(json.gaps.length);
      })
      .catch(() => {
        // Silently ignore — the badge just stays hidden/stale on failure.
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, tick]);

  if (gapCount === 0) return null;

  return (
    <button
      onClick={onOpen}
      className="origin-badge cursor-pointer border-none"
      style={{
        background: 'var(--color-background-warning-subdued)',
        color: 'var(--color-text-warning)',
      }}
      title={`${gapCount} account-month${gapCount === 1 ? '' : 's'} missing coverage`}
    >
      {'⚠'} {gapCount} gap{gapCount === 1 ? '' : 's'}
    </button>
  );
}
