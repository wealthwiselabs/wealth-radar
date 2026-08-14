import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkCredentials,
  constantTimeEqual,
  createSessionToken,
  gateDecision,
  isAuthEnabled,
  verifySessionToken,
} from '@/lib/auth';

const NOW = 1_700_000_000; // fixed epoch seconds

describe('constantTimeEqual', () => {
  it('is true for identical strings', () => {
    expect(constantTimeEqual('hunter2', 'hunter2')).toBe(true);
  });
  it('is false for different strings of equal length', () => {
    expect(constantTimeEqual('hunter2', 'hunterX')).toBe(false);
  });
  it('is false for different lengths', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('session token', () => {
  const secret = 'test-signing-secret';

  it('round-trips: a freshly signed token verifies', async () => {
    const token = await createSessionToken(NOW, secret);
    expect(await verifySessionToken(token, NOW, secret)).toBe(true);
  });

  it('rejects an expired token', async () => {
    const token = await createSessionToken(NOW, secret);
    const wayLater = NOW + 60 * 60 * 24 * 365; // a year on
    expect(await verifySessionToken(token, wayLater, secret)).toBe(false);
  });

  it('rejects a tampered payload/signature', async () => {
    const token = await createSessionToken(NOW, secret);
    const tampered = token.replace(/^\d+/, String(NOW + 999999));
    expect(await verifySessionToken(tampered, NOW, secret)).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken(NOW, secret);
    expect(await verifySessionToken(token, NOW, 'other-secret')).toBe(false);
  });

  it('rejects malformed tokens', async () => {
    expect(await verifySessionToken('garbage', NOW, secret)).toBe(false);
    expect(await verifySessionToken('', NOW, secret)).toBe(false);
  });
});

describe('checkCredentials', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.AUTH_USERNAME = 'wealthwise';
    process.env.AUTH_PASSWORD = 'correct horse';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('accepts the exact username + password', async () => {
    expect(await checkCredentials('wealthwise', 'correct horse')).toBe(true);
  });
  it('rejects a wrong password', async () => {
    expect(await checkCredentials('wealthwise', 'nope')).toBe(false);
  });
  it('rejects a wrong username', async () => {
    expect(await checkCredentials('someone', 'correct horse')).toBe(false);
  });
  it('is password-only when AUTH_USERNAME is unset', async () => {
    delete process.env.AUTH_USERNAME;
    expect(await checkCredentials('anything', 'correct horse')).toBe(true);
    expect(await checkCredentials('anything', 'wrong')).toBe(false);
  });
  it('rejects everything when no password is configured', async () => {
    delete process.env.AUTH_PASSWORD;
    expect(await checkCredentials('wealthwise', 'correct horse')).toBe(false);
  });
});

describe('gateDecision', () => {
  it('enforces when a password is set (any environment)', () => {
    expect(gateDecision({ AUTH_PASSWORD: 'x', NODE_ENV: 'production' })).toBe('enforce');
    expect(gateDecision({ AUTH_PASSWORD: 'x', NODE_ENV: 'development' })).toBe('enforce');
  });
  it('blocks in production when no password is configured (fail closed)', () => {
    expect(gateDecision({ NODE_ENV: 'production' })).toBe('blocked');
  });
  it('stays open in local dev when no password is configured', () => {
    expect(gateDecision({ NODE_ENV: 'development' })).toBe('open');
  });
  it('is open when explicitly disabled, even in production', () => {
    expect(gateDecision({ AUTH_DISABLED: 'true', NODE_ENV: 'production' })).toBe('open');
  });
  it('AUTH_DISABLED overrides a set password', () => {
    expect(gateDecision({ AUTH_DISABLED: 'true', AUTH_PASSWORD: 'x', NODE_ENV: 'production' })).toBe('open');
  });
});

describe('isAuthEnabled', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it('is enabled only when AUTH_PASSWORD is set', () => {
    process.env.AUTH_PASSWORD = 'x';
    expect(isAuthEnabled()).toBe(true);
    delete process.env.AUTH_PASSWORD;
    expect(isAuthEnabled()).toBe(false);
  });
});
