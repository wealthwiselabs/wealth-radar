import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getValuationProvider } from '@/lib/netWorth/providers';
import { makeRentcastProvider } from '@/lib/netWorth/providers/rentcast';

const OLD = process.env.RENTCAST_API_KEY;
afterEach(() => { process.env.RENTCAST_API_KEY = OLD; vi.unstubAllGlobals(); });

describe('getValuationProvider', () => {
  it('returns null when no key is configured', () => {
    delete process.env.RENTCAST_API_KEY;
    expect(getValuationProvider()).toBeNull();
  });

  it('returns the RentCast provider when a key is set', () => {
    process.env.RENTCAST_API_KEY = 'k';
    expect(getValuationProvider()?.key).toBe('rentcast');
  });
});

describe('rentcast provider', () => {
  beforeEach(() => { process.env.RENTCAST_API_KEY = 'k'; });

  it('supports real estate only', () => {
    const p = makeRentcastProvider('k');
    expect(p.supports('real_estate')).toBe(true);
    expect(p.supports('vehicle')).toBe(false);
  });

  it('returns the point value and its range', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ price: 1_150_000, priceRangeLow: 1_090_000, priceRangeHigh: 1_210_000 }),
      { status: 200 })));
    const out = await makeRentcastProvider('k').estimate('1 Main St, Springfield, IL');
    expect(out).toEqual({ value: 1_150_000, low: 1_090_000, high: 1_210_000 });
  });

  it('throws on a non-2xx rather than returning a zero', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 429 })));
    await expect(makeRentcastProvider('k').estimate('x')).rejects.toThrow(/429/);
  });
});
