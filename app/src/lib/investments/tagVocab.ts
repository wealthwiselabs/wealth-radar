/**
 * The security allocation-tag vocabulary — a client-safe module (pure constants,
 * type-only imports) so both the server classifier and the client tag-editor UI
 * can share one source of truth without dragging the DB/Anthropic SDK into the
 * browser bundle.
 */
import type { AssetType } from '@/lib/investments/securities';

export const ASSET_TYPES: readonly AssetType[] = ['equity', 'bond', 'money_market', 'cash', 'insurance', 'other'];
export const REGIONS = ['us', 'intl_developed', 'intl_emerging', 'global'];
export const CAPS = ['large', 'mid', 'small'];
export const STYLES = ['value', 'growth', 'blend'];
export const SECTORS = ['technology', 'real_estate'];
export const KINDS = ['stock', 'etf', 'mutual_fund', 'other'];
