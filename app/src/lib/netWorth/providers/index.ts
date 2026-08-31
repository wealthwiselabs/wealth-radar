import { makeRentcastProvider, type ValuationProvider } from '@/lib/netWorth/providers/rentcast';

export type { ValuationProvider, Estimate } from '@/lib/netWorth/providers/rentcast';

/**
 * The configured provider, or null.
 *
 * 'manual' is not a provider — it is the absence of one, and it is the default
 * for every account. Every call site must handle null, exactly as the Plaid
 * paths handle absent Plaid config.
 */
export function getValuationProvider(): ValuationProvider | null {
  const key = process.env.RENTCAST_API_KEY;
  return key ? makeRentcastProvider(key) : null;
}
