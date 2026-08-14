import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { isPlaidConfigured, getPlaidEnv, getPlaidSecret } from '@/lib/plaid/config';

const save = { ...process.env };
afterEach(() => { process.env = { ...save }; });

describe('plaid config', () => {
  it('is configured only when a client id and a secret are present', () => {
    process.env.PLAID_CLIENT_ID = 'id';
    delete process.env.PLAID_SECRET; delete process.env.PLAID_SECRET_SANDBOX; delete process.env.PLAID_SECRET_PRODUCTION;
    expect(isPlaidConfigured()).toBe(false);
    process.env.PLAID_SECRET = 'sec';
    expect(isPlaidConfigured()).toBe(true);
  });
  it('defaults env to sandbox', () => {
    delete process.env.PLAID_ENV;
    expect(getPlaidEnv()).toBe('sandbox');
  });
  describe('getPlaidSecret picks the active environment', () => {
    beforeEach(() => { delete process.env.PLAID_SECRET; delete process.env.PLAID_SECRET_SANDBOX; delete process.env.PLAID_SECRET_PRODUCTION; });
    it('uses PLAID_SECRET_SANDBOX in sandbox and PLAID_SECRET_PRODUCTION in production', () => {
      process.env.PLAID_SECRET_SANDBOX = 'sbx'; process.env.PLAID_SECRET_PRODUCTION = 'prd';
      process.env.PLAID_ENV = 'sandbox'; expect(getPlaidSecret()).toBe('sbx');
      process.env.PLAID_ENV = 'production'; expect(getPlaidSecret()).toBe('prd');
    });
    it('falls back to a single PLAID_SECRET when no env-specific secret is set', () => {
      process.env.PLAID_SECRET = 'legacy'; process.env.PLAID_ENV = 'production';
      expect(getPlaidSecret()).toBe('legacy');
    });
  });
});
