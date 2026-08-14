/**
 * What counts as spending, and what counts as income.
 *
 * Three kinds of positive amount look alike in the data and mean very different
 * things, which is where the reported totals went wrong:
 *
 *  - a `transfer` is money moving between the user's own accounts (paying a
 *    card leaves checking and lands on the card). Neither leg is spend or
 *    income; counting the outgoing leg double-counts the original purchases;
 *  - a positive amount on a CREDIT account is a refund — a return posting back
 *    to the card. The classifier frequently labels these `income`, which
 *    inflated the income card;
 *  - a positive amount in an ordinary expense category is also a refund, and
 *    used to match neither "expense" (wrong sign) nor "income" (wrong
 *    category), so it silently vanished from both totals.
 *
 * Refunds net against the category they reverse. Everything here is expressed
 * as a signed contribution so the summary cards and the charts can share one
 * definition — they previously disagreed by the size of every transfer.
 */
export const NON_SPENDING_CATEGORIES: readonly string[] = ['income', 'transfer'];

/**
 * Categories where a positive amount is a receipt, not a reversal.
 *
 * A refund only offsets an expense if that expense was ever recorded. Income
 * tax is withheld from payroll, so it never lands in the data as a cost — the
 * paycheque arrives net. An IRS refund is therefore new money, and netting it
 * against the `taxes` category subtracts twelve thousand dollars of "expense"
 * that was never counted, pushing the month negative.
 *
 * A merchandise return is the opposite case: the purchase *is* in the data, so
 * the return must net against it or the category overstates what was spent.
 */
const RECEIPT_CATEGORIES: readonly string[] = ['taxes'];

interface AmountRow {
  amount: number;
  categoryId: string;
  /** Account type from Plaid: 'credit' for cards, 'depository' for bank accounts. */
  accountType?: string;
}

const isTransfer = (t: AmountRow) => t.categoryId === 'transfer';

/**
 * Money posting back to a credit card. Essentially never income — a card
 * cannot pay you — so this is judged by account type rather than by whatever
 * category the classifier guessed.
 */
const isCardRefund = (t: AmountRow) =>
  t.amount > 0 && t.accountType === 'credit' && !isTransfer(t);

/** A receipt rather than a reversal — see RECEIPT_CATEGORIES. Cards are
 *  excluded: a refund to a card is always reversing a charge on that card. */
const isReceipt = (t: AmountRow) =>
  t.amount > 0 && t.accountType !== 'credit' && RECEIPT_CATEGORIES.includes(t.categoryId);

/**
 * Signed contribution to total expenses: positive for spend, negative for a
 * refund, zero for anything that isn't spending.
 */
export function expenseAmount(t: AmountRow): number {
  if (isTransfer(t)) return 0;
  if (isReceipt(t)) return 0;                   // counted as income instead
  if (isCardRefund(t)) return -t.amount;        // reduces what that category cost
  if (t.categoryId === 'income') return 0;
  return -t.amount;                             // -(-25) = 25 spend; -(+18.67) = refund
}

/**
 * Which category bucket a row's expense contribution belongs to.
 *
 * Normally its own category — but a card refund's stored category cannot be
 * trusted (the classifier labels these `income`, which is never a real expense
 * category), and charts drop non-spending categories when rendering. Left
 * as-is the refund would be silently discarded from the chart while still
 * counting in the summary, putting the two back out of step. `other` is the
 * catch-all: honest about not knowing which purchase is being reversed.
 */
export function expenseCategoryId(t: AmountRow): string {
  return NON_SPENDING_CATEGORIES.includes(t.categoryId) ? 'other' : t.categoryId;
}

/** Contribution to total income: only genuine receipts. */
export function incomeAmount(t: AmountRow): number {
  if (isTransfer(t) || isCardRefund(t)) return 0;
  if (isReceipt(t)) return t.amount;
  return t.amount > 0 && t.categoryId === 'income' ? t.amount : 0;
}

/** Total expenses, net of refunds. */
export function sumExpenses(txns: readonly AmountRow[]): number {
  return txns.reduce((sum, t) => sum + expenseAmount(t), 0);
}

/** Total income. */
export function sumIncome(txns: readonly AmountRow[]): number {
  return txns.reduce((sum, t) => sum + incomeAmount(t), 0);
}

export interface MonthTotal { month: string; total: number }

/**
 * Net spend per calendar month, oldest first.
 *
 * Shared by the monthly chart (which draws these as stacked bars) and by the
 * header that reports their trailing average, so the two can never disagree —
 * a headline average that contradicted the totals printed on the bars beneath
 * it would read as a bug even when both were individually defensible.
 *
 * Sums `expenseAmount` over every row, which is equivalent to summing the
 * chart's own stacked segments: transfers and income contribute zero, and
 * every other category is drawn. (That equivalence assumes each row's category
 * exists in the taxonomy; an orphan id would be counted here but have no bar
 * to be drawn in.)
 */
export function monthlyExpenseTotals(
  txns: readonly (AmountRow & { date: string })[],
): MonthTotal[] {
  const byMonth = new Map<string, number>();
  for (const t of txns) {
    const contribution = expenseAmount(t);
    if (contribution === 0) continue;
    const month = t.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + contribution);
  }
  return [...byMonth.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Income per calendar month, oldest first — the `incomeAmount` sibling of
 * `monthlyExpenseTotals`.
 *
 * Shares the receipt/refund/transfer rules with the summary cards, so the
 * homepage's income line can never disagree with the Total Income figure
 * printed above it. A month contributing nothing is omitted rather than
 * emitted as a zero, matching the expense side.
 */
export function monthlyIncomeTotals(
  txns: readonly (AmountRow & { date: string })[],
): MonthTotal[] {
  const byMonth = new Map<string, number>();
  for (const t of txns) {
    const contribution = incomeAmount(t);
    if (contribution === 0) continue;
    const month = t.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + contribution);
  }
  return [...byMonth.entries()]
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export interface TrailingAverage {
  average: number;
  /** How many months actually went into it — may be < windowSize early on. */
  monthsUsed: number;
  from: string;
  to: string;
}

/** Default window. See the note below for why this is 6 and not 3 or "all". */
export const TRAILING_AVERAGE_MONTHS = 6;

/**
 * Average monthly spend over the most recent complete months.
 *
 * Two exclusions, for different reasons:
 *
 * - The CURRENT month is dropped because it is still accumulating; including a
 *   month that is three days old drags the average down by an amount that has
 *   nothing to do with spending.
 *
 * - Everything before the window is dropped because the early history of this
 *   dataset is a coverage ramp, not a spending record: the first months hold
 *   one or two accounts' statements while the rest had yet to be imported or
 *   linked. Averaging across all of history reads roughly 18% low, and does so
 *   plausibly enough that nobody would question it. A trailing window ages that
 *   ramp out on its own, with no month ever needing to be special-cased.
 *
 * Six months rather than three because the big items here are lumpy — property
 * tax lands twice a year and tuition runs on its own cycle — so a three-month
 * window swings ~19% purely on where it happens to sit. Six reliably spans one
 * property-tax installment while still tracking current behavior.
 */
export function trailingMonthlyAverage(
  totals: readonly MonthTotal[],
  currentMonth: string,
  windowSize: number = TRAILING_AVERAGE_MONTHS,
): TrailingAverage | null {
  const complete = totals
    .filter((m) => m.month < currentMonth)
    .sort((a, b) => a.month.localeCompare(b.month));
  if (complete.length === 0) return null;

  const window = complete.slice(-windowSize);
  const sum = window.reduce((acc, m) => acc + m.total, 0);
  return {
    average: sum / window.length,
    monthsUsed: window.length,
    from: window[0].month,
    to: window[window.length - 1].month,
  };
}
