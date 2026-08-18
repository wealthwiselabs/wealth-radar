import { lookup } from 'node:dns/promises';
import type { Tool } from './types';

const MAX_BODY_BYTES = 1_500_000;
const MAX_CONTENT_CHARS = 4000;

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
  return false;
}

/**
 * True if `ip` is a loopback/private/link-local/unique-local/metadata address
 * that must never be fetched. Accepts a bare IPv4 or IPv6 literal (as returned
 * by DNS `lookup`). Used to catch a public hostname that RESOLVES to an
 * internal address — an SSRF vector the sync `isFetchableUrl` literal check
 * cannot see. IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is unwrapped and re-checked.
 */
export function isBlockedIp(ip: string): boolean {
  const addr = ip.trim().toLowerCase();

  // IPv4 (or the IPv4 tail of an IPv4-mapped IPv6 address).
  const asV4 = (s: string): boolean => {
    const parts = s.split('.');
    if (parts.length !== 4) return false;
    const octets = parts.map((p) => Number(p));
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = octets;
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. metadata)
    return false;
  };

  if (asV4(addr)) return true;

  // IPv6.
  if (addr.includes(':')) {
    // IPv4-mapped (::ffff:127.0.0.1) — unwrap the trailing dotted-quad.
    const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped && asV4(mapped[1])) return true;
    if (addr === '::1') return true; // loopback
    const head = addr.split(':')[0];
    // fc00::/7 unique-local: first hex group is fc.. or fd..
    if (/^f[cd][0-9a-f]{0,2}$/.test(head)) return true;
    // fe80::/10 link-local: fe80..febf
    if (/^fe[89ab][0-9a-f]?$/.test(head)) return true;
  }

  return false;
}

export function isFetchableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost') return false;
    if (hostname === '::1') return false;
    // Handle bracketed IPv6 loopback form, e.g. "[::1]" -> hostname is "::1" already stripped by URL parsing,
    // but guard against literal "[::1]" just in case of manual construction.
    if (hostname === '[::1]') return false;
    if (isPrivateIPv4(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function stripHtml(html: string): string {
  const withoutScriptsAndStyles = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutScriptsAndStyles.replace(/<[^>]+>/g, ' ');
  return withoutTags.replace(/\s+/g, ' ').trim();
}

export const webFetchTool: Tool = {
  gate: 'none',
  spec: {
    name: 'web_fetch',
    description:
      'Fetch a public web page by URL and return its text content (HTML tags stripped, truncated to ~4000 characters). ' +
      'Refuses to fetch local/private/metadata addresses.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The http(s) URL to fetch' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  async run(input: { url: string }) {
    const { url } = input;
    // Fast literal pre-check: rejects obviously-internal hosts before any I/O.
    if (!isFetchableUrl(url)) {
      return { content: 'Refusing to fetch that URL (must be a public http(s) address).' };
    }
    // DNS re-check: a PUBLIC hostname can still RESOLVE to an internal address
    // (DNS rebinding / SSRF). Resolve every A/AAAA record and refuse if ANY of
    // them is loopback/private/link-local/unique-local/metadata.
    try {
      const host = new URL(url).hostname;
      const resolved = await lookup(host, { all: true });
      if (resolved.some((r) => isBlockedIp(r.address))) {
        return { content: 'Refusing to fetch that URL (must be a public http(s) address).' };
      }
    } catch {
      return { content: 'Could not fetch that URL (timed out or unreachable).' };
    }
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        redirect: 'follow',
      });
      // Post-redirect literal re-check: a 3xx may have pointed res.url at a
      // literal internal address.
      if (!isFetchableUrl(res.url)) {
        return { content: 'Refusing to fetch that URL (must be a public http(s) address).' };
      }
      const buffer = await res.arrayBuffer();
      const capped = buffer.byteLength > MAX_BODY_BYTES ? buffer.slice(0, MAX_BODY_BYTES) : buffer;
      const text = new TextDecoder('utf-8', { fatal: false }).decode(capped);
      const plain = stripHtml(text).slice(0, MAX_CONTENT_CHARS);
      return { content: plain };
    } catch {
      return { content: 'Could not fetch that URL (timed out or unreachable).' };
    }
  },
};

export const webTools: Tool[] = [webFetchTool];
