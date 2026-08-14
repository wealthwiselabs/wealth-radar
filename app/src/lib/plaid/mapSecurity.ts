import type { SecurityInput, AssetType, SecurityKind } from '@/lib/investments/securities';

// Plaid security.type → our (kind, assetType). Money-market funds are mutual
// funds by wrapper but money_market by asset class, so the two axes differ.
function mapType(type: string | null | undefined, name: string): { kind: SecurityKind; assetType: AssetType } {
  switch ((type ?? '').toLowerCase()) {
    case 'etf': return { kind: 'etf', assetType: 'equity' };
    case 'equity': return { kind: 'stock', assetType: 'equity' };
    case 'mutual fund': {
      // A money-market mutual fund reads as money_market, not equity.
      const isMoneyMarket = /money market|money mkt|federal money/i.test(name);
      return { kind: 'mutual_fund', assetType: isMoneyMarket ? 'money_market' : 'equity' };
    }
    case 'fixed income': return { kind: 'other', assetType: 'bond' };
    case 'cash': return { kind: 'other', assetType: 'cash' };
    default: return { kind: 'other', assetType: 'other' };
  }
}

export function mapPlaidSecurity(security: {
  ticker_symbol?: string | null;
  name?: string | null;
  type?: string | null;
}): SecurityInput {
  const name = (security.name ?? '').trim() || 'Unknown security';
  const ticker = (security.ticker_symbol ?? '').trim() || null;
  const { kind, assetType } = mapType(security.type, name);
  return { ticker, name, kind, assetType, tagSource: 'plaid' };
}
