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
 *
 * `refetch` may be async. Its result is deliberately not awaited — but a
 * rejection is caught here rather than left to escape as an unhandled one.
 * The moment this fires is precisely when the network is least reliable (the
 * machine has just woken, or the dev server is restarting), so callers are
 * expected to handle their own failures; this is the backstop that keeps a
 * caller who forgets from throwing an error overlay at the user.
 */
export function useRefreshOnFocus(refetch: () => void | Promise<void>): void {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      try {
        void Promise.resolve(refetch()).catch((error) => {
          console.error('Refresh on focus failed:', error);
        });
      } catch (error) {
        // A refetch that throws synchronously never returns a promise.
        console.error('Refresh on focus failed:', error);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetch]);
}
