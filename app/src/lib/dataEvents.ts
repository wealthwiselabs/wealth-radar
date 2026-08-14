/**
 * A one-line pub/sub for "the underlying data changed".
 *
 * The gaps badge lives in the site header while the actions that change
 * coverage (sync, import, account edits) happen inside pages, so there is no
 * shared React state to thread a refresh key through. Rather than lift all of
 * that into a context for a single badge, the pages announce and the badge
 * listens.
 */
const EVENT = 'expense-tracker:data-changed';

export function notifyDataChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Subscribe; returns an unsubscribe function for effect cleanup. */
export function onDataChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
