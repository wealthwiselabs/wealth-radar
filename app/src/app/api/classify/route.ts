import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { readTaxonomy, readRules } from '@/lib/storage';
import { resolveRule } from '@/lib/categoryRules';
import { formatTaxonomyForPrompt, formatRulesForPrompt } from '@/lib/classifyPrompt';
import { verifyMaskInText } from '@/lib/accountMask';
import type { ClassifyRequest, ClassifyResponse } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ClassifyRequest;
    const { pdfText, fileName } = body;

    if (!pdfText) {
      return NextResponse.json(
        { error: 'pdfText is required' },
        { status: 400 }
      );
    }

    // Prefer per-request key from the browser; fall back to server env var.
    // Allows running the app without editing .env.local — users paste their key in the UI.
    const headerKey = request.headers.get('x-anthropic-api-key');
    const apiKey = headerKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error: 'No Anthropic API key configured',
          details:
            'Set one in Settings (saved to your browser) or add ANTHROPIC_API_KEY to .env.local.',
        },
        { status: 401 }
      );
    }

    const client = new Anthropic({ apiKey });

    // Load taxonomy and user-confirmed rules
    const taxonomy = await readTaxonomy();
    const rules = await readRules();

    const taxonomyPrompt = formatTaxonomyForPrompt(taxonomy.categories);
    const prefsPrompt = formatRulesForPrompt(rules);

    const systemPrompt = `You are a financial transaction classifier. Your job is to:
1. Extract transactions from bank statement text
2. Identify the bank and account type
3. Classify each transaction into the appropriate category and subcategory
4. Report the last 4 digits of the account or card number exactly as printed on the statement, as "mask". If the statement does not show an account or card number, use null. Never guess or infer these digits.

TAXONOMY (use these exact category and subcategory IDs):
${taxonomyPrompt}

${prefsPrompt}

IMPORTANT RULES:
- Use NEGATIVE amounts for expenses (money going out)
- Use POSITIVE amounts for income (money coming in)
- Match the exact categoryId and subcategoryId from the taxonomy
- If a merchant is ambiguous, prefer the user's confirmed rules above
- For merchants that could be groceries or general shopping (like Target, Walmart, Costco), use context clues or default to "shopping > general" unless you have preference data
- ASSET TRANSFERS (NOT expenses): money moved from a bank account into a brokerage / investment account is "transfer > investment". Watch for descriptions like "Vanguard Buy Investment", "VMC PUR", "Fidelity Brokerage", "Schwab", "Robinhood", "Coinbase", "Wealthfront", "Betterment", "Merrill", "E*TRADE", "TD Ameritrade", "SoFi Invest", "M1 Finance". These are negative amounts but should NOT be classified as expenses or general transfers — use "transfer > investment".
- Money flowing the other direction (brokerage → bank account, e.g. "Vanguard Sell Investment") is the user moving their OWN money and is "transfer > investment" — not income. Dividends and interest actually paid out are "income > interest-earned".
- Be careful: "Fidelity Bank" (the regular bank) is NOT the brokerage — a P2P transfer to someone whose bank happens to be Fidelity Bank is "transfer > between-accounts", not investment.
- CASH / ATM WITHDRAWALS: classify as "kids > activities" by default. Descriptions like "ATM Withdrawal", "Cash Withdrawal", "Cash Advance" — the user typically uses cash to pay for kids' extracurricular classes (piano, etc.). Treat as expense, NOT a transfer. Exception: if a separate ATM/non-network fee line item appears (e.g. "ATM Fee $3.50"), classify that fee line as "financial > bank-fees" while still routing the withdrawal itself to "kids > activities".
- CREDIT CARD PAYMENTS are ALWAYS "transfer > cc-payment", regardless of sign or which side of the statement they appear on. On a credit-card statement, payments arrive as POSITIVE amounts with descriptions like "AUTOMATIC PAYMENT - THANK YOU", "AUTOPAY PAYMENT RECEIVED - THANK YOU", "PAYMENT THANK YOU", "PAYMENT RECEIVED". Do NOT classify these as "income > transfer-in" — they are not income, they are the user paying down their card from another account. On a checking-account statement the same payment appears as NEGATIVE with descriptions like "Chase Credit Crd Autopay", "Card Payment", "AmEx EPayment". Both sides → "transfer > cc-payment".
- REFUNDS AND RETURNS: a POSITIVE amount on a credit-card statement is money coming back for something bought on that card — a return, price adjustment or reversed charge. Classify it with the category of the item that was returned (a clothing return is "shopping > clothing", a returned e-book is "entertainment"), NEVER as income. "income > refund" is only for money arriving that never had a matching expense, such as a rebate cheque or settlement.
- TAX REFUNDS from a government (e.g. "IRS TREAS 310 TAX REF", state franchise tax refunds) → "taxes > income-tax-refund". Tax payments → "taxes > income-tax-payment".
- A WAIVED or REVERSED FEE (e.g. "Monthly Maintenance Fee Waived") → "financial > bank-fees". It is the absence of a charge, not income.
- Dates should be in YYYY-MM-DD format
- Include the original description exactly as shown in the statement`;

    const userPrompt = `Parse this bank statement and classify each transaction.

Source file: ${fileName}

Bank Statement Text:
${pdfText}

Return a JSON object with this structure:
{
  "bank": "Bank Name",
  "account": "Account Type (e.g., Checking, Savings, Credit Card)",
  "mask": "3110" or null,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "Original transaction description",
      "amount": -123.45,
      "categoryId": "category-id",
      "subcategoryId": "subcategory-id",
      "note": ""
    }
  ]
}

IMPORTANT: Return ONLY the JSON object, no markdown code blocks or other text.`;

    // Cache the system prompt (taxonomy + preferences) — identical across PDFs in a batch,
    // so calls 2..N in a folder import pay ~10% on the cached portion.
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    // Extract text response
    const responseText = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // Parse JSON response
    let result: { bank: string; account: string; mask?: string | null; transactions: Array<{
      date: string;
      description: string;
      amount: number;
      categoryId: string;
      subcategoryId: string;
      note: string;
    }> };

    try {
      // Try to extract JSON from the response (handle potential markdown code blocks)
      let jsonStr = responseText.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      result = JSON.parse(jsonStr);
    } catch {
      console.error('Failed to parse LLM response:', responseText);
      return NextResponse.json(
        { error: 'Failed to parse classification response', details: responseText },
        { status: 500 }
      );
    }

    // Apply user-confirmed rules. Definitive on first use — no repeat-count threshold.
    const transactions = result.transactions.map((t) => {
      const rule = resolveRule(t.description, rules);
      if (rule) {
        return {
          ...t,
          categoryId: rule.categoryId,
          subcategoryId: rule.subcategoryId,
        };
      }
      return t;
    });

    // Trust the model's digits only if the statement actually prints them as an
    // account number — a wrong mask can silently fuse two accounts at merge time.
    const mask = verifyMaskInText(result.mask, pdfText);

    const response: ClassifyResponse = {
      bank: result.bank,
      account: result.account,
      mask,
      transactions: transactions.map((t) => ({
        ...t,
        bank: result.bank,
        account: result.account,
        mask,
        source: fileName,
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Classification error:', error);
    return NextResponse.json(
      { error: 'Failed to classify transactions', details: String(error) },
      { status: 500 }
    );
  }
}
