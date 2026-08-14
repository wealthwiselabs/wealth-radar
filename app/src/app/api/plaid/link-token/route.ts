import { NextRequest, NextResponse } from 'next/server';
import { CountryCode, Products } from 'plaid';
import { eq, and } from 'drizzle-orm';
import { getPlaidClient } from '@/lib/plaid/client';
import { isPlaidConfigured, getPlaidCountryCodes } from '@/lib/plaid/config';
import { getDb, schema } from '@/db/client';
import { decryptToken } from '@/lib/crypto';

export async function POST(request: NextRequest) {
  if (!isPlaidConfigured()) return NextResponse.json({ error: 'Plaid not configured' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const itemId: string | undefined = body?.itemId;
  const client = getPlaidClient();
  const base = {
    user: { client_user_id: 'local-user' },
    client_name: 'Wealthwise',
    country_codes: getPlaidCountryCodes() as CountryCode[],
    language: 'en',
  };

  if (itemId) {
    const db = getDb();
    const item = db.select().from(schema.plaidItems).where(eq(schema.plaidItems.id, itemId)).get();
    if (!item) return NextResponse.json({ error: 'Unknown connection' }, { status: 404 });
    const hasInvestment = db.select().from(schema.accounts)
      .where(and(eq(schema.accounts.plaidItemId, itemId), eq(schema.accounts.accountClass, 'investment'))).get();
    // Update mode: reuse the existing Item's access_token so no new Item is created.
    // Request Investments only when the Item actually has an investment account,
    // so a bank-only reconnect just re-auths the login.
    const resp = await client.linkTokenCreate({
      ...base,
      access_token: decryptToken(item.accessToken),
      ...(hasInvestment ? { products: [Products.Investments] } : {}),
    });
    return NextResponse.json({ link_token: resp.data.link_token });
  }

  const resp = await client.linkTokenCreate({
    ...base,
    products: [Products.Transactions],
    optional_products: [Products.Investments],
  });
  return NextResponse.json({ link_token: resp.data.link_token });
}
