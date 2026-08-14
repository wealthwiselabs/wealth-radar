import { CountryCode } from 'plaid';

export function getPlaidEnv(): 'sandbox' | 'production' {
  return process.env.PLAID_ENV === 'production' ? 'production' : 'sandbox';
}

// The secret for the ACTIVE environment: prefers PLAID_SECRET_SANDBOX /
// PLAID_SECRET_PRODUCTION (so both can coexist and you just flip PLAID_ENV),
// falling back to a single PLAID_SECRET for backward compatibility.
export function getPlaidSecret(): string | undefined {
  return process.env[`PLAID_SECRET_${getPlaidEnv().toUpperCase()}`] || process.env.PLAID_SECRET;
}

export function isPlaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && getPlaidSecret());
}

export function getPlaidCountryCodes(): CountryCode[] {
  return (process.env.PLAID_COUNTRY_CODES ?? 'US')
    .split(',')
    .map((c) => c.trim() as CountryCode);
}
