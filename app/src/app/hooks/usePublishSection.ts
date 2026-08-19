'use client';

import { useEffect } from 'react';
import { setViewSection, removeViewSection, type ViewSection } from '@/app/lib/viewContext';

/**
 * Register this section's summary into the shared view context so the agent can
 * see it in <current_view> and knows which tool pulls its full data. Pass null
 * while the section has no data yet (loading/error) to omit it. Removes the
 * section on unmount. Compared by value so an inline object doesn't churn.
 */
export function usePublishSection(section: ViewSection | null): void {
  useEffect(() => {
    if (!section) return;
    setViewSection(section);
    return () => removeViewSection(section.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compare by value, not identity.
  }, [JSON.stringify(section)]);
}
