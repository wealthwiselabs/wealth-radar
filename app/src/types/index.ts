// Transaction represents a single financial transaction
export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // Negative for expenses, positive for income
  owner: string; // '' when unassigned — display omits it
  bank: string;
  account: string;
  accountId: string;
  accountClass: 'spending' | 'investment' | 'liability';
  /** Plaid account type ('credit' | 'depository' | …); distinguishes a card
   *  refund from real income, which share the same positive sign. */
  accountType: string;
  categoryId: string;
  subcategoryId: string;
  note: string;
  source: string; // Original PDF filename
  createdAt: string; // ISO timestamp
  modifiedAt: string; // ISO timestamp
}

// Subcategory within a category
export interface Subcategory {
  id: string;
  name: string;
  description: string;
  examples: string[];
}

// Category with subcategories
export interface Category {
  id: string;
  name: string;
  description: string;
  color: string;
  subcategories: Subcategory[];
}

// Full taxonomy structure
export interface Taxonomy {
  version: string;
  categories: Category[];
}

// Classification request from PDF
export interface ClassifyRequest {
  pdfText: string;
  fileName: string;
}

// A transaction as it exists before DB persistence (classify -> pending -> POST):
// no id/timestamps yet, and accountId/accountClass/owner are assigned only once
// the row is persisted and joined to an account. A statement PDF never states
// whose card it is, so `owner` cannot exist at classify time — but it does print
// the card number, which is why `mask` can.
export type PendingTransaction = Omit<
  Transaction,
  'id' | 'createdAt' | 'modifiedAt' | 'accountId' | 'accountClass' | 'accountType' | 'owner'
> & {
  /** Last 4 of the card, read from the statement text and verified against it. */
  mask?: string | null;
};

// Classification response
export interface ClassifyResponse {
  bank: string;
  account: string;
  /** Verified last 4 of the card, or null when the statement shows none. */
  mask: string | null;
  transactions: PendingTransaction[];
}

// API error response
export interface ApiError {
  error: string;
  details?: string;
}

// Date range filter
export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

// Export format options
export type ExportFormat = 'csv' | 'json';

// Transaction update request (partial)
export interface TransactionUpdate {
  categoryId?: string;
  subcategoryId?: string;
  note?: string;
}

// Chart data point
export interface ChartDataPoint {
  label: string;
  value: number;
  color: string;
}

// Monthly chart data grouped by category
export interface MonthlyChartData {
  month: string; // YYYY-MM
  categories: Record<string, number>; // categoryId -> total amount
}

// A user-confirmed classification rule: description contains `pattern` → category.
export interface CategoryRule {
  id: string;
  /** Lowercased, trimmed, whitespace-collapsed. See normalizePattern. */
  pattern: string;
  categoryId: string;
  subcategoryId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
