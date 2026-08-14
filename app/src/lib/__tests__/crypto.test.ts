import { describe, it, expect, beforeEach } from 'vitest';
import { encryptToken, decryptToken } from '@/lib/crypto';

describe('token encryption', () => {
  beforeEach(() => {
    // 32-byte key, base64
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  it('round-trips a token', () => {
    const secret = 'access-sandbox-abc123';
    const enc = encryptToken(secret);
    expect(enc).not.toContain(secret);        // not plaintext
    expect(decryptToken(enc)).toBe(secret);
  });

  it('produces different ciphertext each call (random IV)', () => {
    expect(encryptToken('x')).not.toBe(encryptToken('x'));
  });

  it('throws a clear error when the key is missing', () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => encryptToken('x')).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
