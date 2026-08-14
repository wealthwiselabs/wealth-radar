import { describe, it, expect } from 'vitest';
import { classifyStatementType } from '@/lib/investments/detectStatement';

const VG_MONTHLY = `
  Vanguard Brokerage Account   INVESTMENT REPORT   January 1 – January 31, 2025
  Account Value: $412,308.55   Beginning Value $400,120.00   Ending Value $412,308.55
  Holdings
  Symbol  Description                     Quantity      Price     Market Value
  VTSAX   Vanguard Total Stock Mkt Idx    1,204.882    $128.40    $154,706.85
  VBTLX   Vanguard Total Bond Market      2,010.114     $9.71     $19,518.21
`;

const FIDELITY_401K = `
  Fidelity NetBenefits   Retirement Savings Statement   Acme 401(k)
  Your Account Value: $88,204.12   Vested Balance: $88,204.12
  Contribution Summary
  Employee Pre-Tax     $1,250.00
  Employer Match         $625.00
  Number of Shares   Investment                       Ending Balance
`;

const CHASE_CHECKING = `
  CHASE   Total Checking   Account Number: 000000123456
  Beginning Balance          $4,102.55
  Deposits and Additions     $6,200.00
  Electronic Withdrawals    -$5,890.11
  Ending Balance             $4,412.44
  ATM Withdrawal 01/12 ...  -$100.00
`;

const CREDIT_CARD = `
  Chase Sapphire   Statement Period 01/01 – 01/31
  Minimum Payment Due: $40.00   Available Credit: $12,110.00
  Payment Information
  AUTOMATIC PAYMENT - THANK YOU   -$1,204.55
  Purchases   Amazon.com   $54.20
`;

describe('classifyStatementType', () => {
  it('detects a Vanguard brokerage statement as investment', () => {
    expect(classifyStatementType(VG_MONTHLY)).toBe('investment');
  });
  it('detects a Fidelity 401k statement as investment', () => {
    expect(classifyStatementType(FIDELITY_401K)).toBe('investment');
  });
  it('detects a Chase checking statement as bank', () => {
    expect(classifyStatementType(CHASE_CHECKING)).toBe('bank');
  });
  it('detects a credit-card statement as bank', () => {
    expect(classifyStatementType(CREDIT_CARD)).toBe('bank');
  });
  it('is bank on empty/garbage text (no investment signals)', () => {
    expect(classifyStatementType('')).toBe('bank');
    expect(classifyStatementType('lorem ipsum dolor sit amet')).toBe('bank');
  });
});
