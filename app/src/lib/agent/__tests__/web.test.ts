import { describe, it, expect } from 'vitest';
import { isFetchableUrl, isBlockedIp } from '@/lib/agent/tools/web';

describe('isFetchableUrl', () => {
  it('allows public http(s) and blocks local/meta/non-http', () => {
    expect(isFetchableUrl('https://example.com/x')).toBe(true);
    expect(isFetchableUrl('http://93.184.216.34/')).toBe(true);
    expect(isFetchableUrl('http://localhost/')).toBe(false);
    expect(isFetchableUrl('http://127.0.0.1/')).toBe(false);
    expect(isFetchableUrl('http://10.0.0.5/')).toBe(false);
    expect(isFetchableUrl('http://192.168.1.1/')).toBe(false);
    expect(isFetchableUrl('http://169.254.169.254/')).toBe(false);
    expect(isFetchableUrl('file:///etc/passwd')).toBe(false);
    expect(isFetchableUrl('ftp://example.com')).toBe(false);
  });
});

describe('isBlockedIp', () => {
  it('blocks loopback/private/link-local/unique-local/metadata addresses', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('10.1.2.3')).toBe(true);
    expect(isBlockedIp('172.20.0.1')).toBe(true);
    expect(isBlockedIp('192.168.5.5')).toBe(true);
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('fc00::1')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
  });

  it('allows public addresses', () => {
    expect(isBlockedIp('93.184.216.34')).toBe(false);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('2606:2800:220:1::')).toBe(false);
  });
});
