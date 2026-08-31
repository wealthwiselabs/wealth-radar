export interface Estimate { value: number; low: number | null; high: number | null }

export interface ValuationProvider {
  key: string;
  supports(subtype: string): boolean;
  estimate(ref: string): Promise<Estimate>;
}

/**
 * RentCast AVM lookup.
 *
 * Chosen over Zillow because Zillow's public Zestimate API was retired in 2021
 * and its only official replacement is MLS-gated; the wrapper services that
 * resell Zestimates scrape against Zillow's terms. RentCast is self-serve, its
 * free tier is 50 requests/month, and its licensing permits consumer apps.
 *
 * Never returns a fallback value. A failed lookup throws, so the caller writes
 * nothing and the property stays in the stale list — a silent failure that
 * leaves a stale value looking current is the worst outcome available here.
 */
export function makeRentcastProvider(apiKey: string): ValuationProvider {
  return {
    key: 'rentcast',
    supports: (subtype) => subtype === 'real_estate',
    async estimate(ref: string): Promise<Estimate> {
      const url = `https://api.rentcast.io/v1/avm/value?address=${encodeURIComponent(ref)}`;
      const res = await fetch(url, { headers: { 'X-Api-Key': apiKey, accept: 'application/json' } });
      if (!res.ok) throw new Error(`RentCast returned HTTP ${res.status}`);
      const body = await res.json() as {
        price?: number; priceRangeLow?: number; priceRangeHigh?: number;
      };
      if (typeof body.price !== 'number' || !Number.isFinite(body.price)) {
        throw new Error('RentCast returned no usable price');
      }
      return {
        value: body.price,
        low: typeof body.priceRangeLow === 'number' ? body.priceRangeLow : null,
        high: typeof body.priceRangeHigh === 'number' ? body.priceRangeHigh : null,
      };
    },
  };
}
