// Browser-only helpers for storing the user's Anthropic API key in localStorage.
// The key is sent per-request as the `x-anthropic-api-key` header to /api/classify,
// so users can run the app without editing .env.local.

const STORAGE_KEY = 'expense-tracker:anthropic-api-key';

export function getStoredApiKey(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(STORAGE_KEY) || '';
}

export function setStoredApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = key.trim();
  if (trimmed) {
    window.localStorage.setItem(STORAGE_KEY, trimmed);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
