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

// Provider-scoped headers for the agent chat endpoint. Generalizes the single
// Anthropic API key above into a small set of `x-agent-*` headers so the
// agent can be pointed at other providers/models/base URLs via localStorage,
// while the underlying stored key (and its existing helpers) stay unchanged.
export function getAgentKeyHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const provider = window.localStorage.getItem('wealthwise:agent-provider') || 'anthropic';
  const model =
    window.localStorage.getItem('wealthwise:agent-model') ||
    (provider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-5.6');
  const headers: Record<string, string> = {
    'x-agent-provider': provider,
    'x-agent-model': model,
  };
  const key = getStoredApiKey();
  if (key) headers['x-agent-api-key'] = key;
  const baseURL = window.localStorage.getItem('wealthwise:agent-base-url');
  if (baseURL) headers['x-agent-base-url'] = baseURL;
  return headers;
}
