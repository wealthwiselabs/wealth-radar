'use client';

import { useEffect } from 'react';
import { setViewContext, type ViewSnapshot } from '@/app/lib/viewContext';

/**
 * Publish a compact snapshot of the current page to the shared view-context
 * store so the chat panel can send it with each message. Republishes whenever
 * the snapshot's contents change (compared by value) and clears it on unmount.
 */
export function usePublishViewContext(snapshot: ViewSnapshot | null): void {
  useEffect(() => {
    setViewContext(snapshot);
    return () => setViewContext(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compare snapshot by value, not identity, so an inline object doesn't republish every render.
  }, [JSON.stringify(snapshot)]);
}
