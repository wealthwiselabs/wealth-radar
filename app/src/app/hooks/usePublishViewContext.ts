'use client';

import { useEffect } from 'react';
import { setViewBase, type ViewSnapshot } from '@/app/lib/viewContext';

/**
 * Publish the page-level base snapshot (route, label, highlights, filters) to the
 * shared view-context store. Sections are published separately by the components
 * that render them (see usePublishSection). Republishes when the snapshot's
 * contents change (compared by value) and clears the base on unmount.
 */
export function usePublishViewContext(snapshot: ViewSnapshot | null): void {
  useEffect(() => {
    setViewBase(snapshot);
    return () => setViewBase(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compare snapshot by value, not identity, so an inline object doesn't republish every render.
  }, [JSON.stringify(snapshot)]);
}
