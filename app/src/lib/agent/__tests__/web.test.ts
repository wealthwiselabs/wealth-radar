import { describe, it, expect } from 'vitest';
import { isFetchableUrl } from '@/lib/agent/tools/web';

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
