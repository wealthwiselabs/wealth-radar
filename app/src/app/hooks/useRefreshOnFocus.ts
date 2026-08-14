'use client';

import { useEffect } from 'react';

/**
 * Rerun `refetch` when the tab becomes visible again.
 *
 * A background sync runs in the server process and cannot reach an open tab —
 * `dataEvents` is client-only and the server can't dispatch it. Refetching on
 * focus is the bridge: whatever the last unattended sync pulled shows the next
 * time the user looks at the page. Pass a stable (useCallback'd) `refetch` so
 * the listener isn't re-registered every render.
 */
export function useRefreshOnFocus(refetch: () => void): void {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetch]);
}
