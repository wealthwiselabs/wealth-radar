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
    if (!isFetchableUrl(url)) {
      return { content: 'Refusing to fetch that URL (must be a public http(s) address).' };
    }
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        redirect: 'follow',
      });
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
