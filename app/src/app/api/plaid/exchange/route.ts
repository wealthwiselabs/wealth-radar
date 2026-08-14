import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { getPlaidClient } from '@/lib/plaid/client';
import { isPlaidConfigured, getPlaidCountryCodes } from '@/lib/plaid/config';
import { encryptToken } from '@/lib/crypto';
import { getDb, schema } from '@/db/client';
import { mapPlaidAccount } from '@/lib/plaid/mapAccount';
import { resolveOrCreateAccount } from '@/lib/accounts';
import { unsuppressPlaidAccount } from '@/lib/plaidSuppression';
import { autoMergePlaidIntoHistory } from '@/lib/accountAutoMerge';
import { maybeSyncInvestmentsForItem } from '@/lib/plaid/syncInvestments';
import { syncInvestmentTransactions } from '@/lib/investments/investmentTransactions';
import { classifyUntaggedSecurities } from '@/lib/investments/classifySecurities';
import { ACCOUNT_OWNERS } from '@/lib/owners';

export async function POST(request: NextRequest) {
  if (!isPlaidConfigured()) return NextResponse.json({ error: 'Plaid not configured' }, { status: 404 });
  // Probe the encryption key BEFORE any Plaid call, so we never fetch an access
  // token we can't store (which would leave an orphaned Plaid Item).
  try { encryptToken('probe'); } catch {
    return NextResponse.json({ error: 'APP_ENCRYPTION_KEY is missing or invalid (needs a base64 32-byte key) — cannot securely store the bank connection.' }, { status: 500 });
  }
  const { public_token, owner } = await request.json();
  if (!public_token) return NextResponse.json({ error: 'public_token required' }, { status: 400 });
  // Whose bank login is this? Every account discovered on the Item inherits it,
  // so a second person's connection is attributed without manual tagging.
  // REQUIRED, not defaulted: silently accepting a missing owner is how a whole
  // Item's accounts end up unassigned with no error to show for it.
  if (!ACCOUNT_OWNERS.includes(owner)) {
    return NextResponse.json({ error: `owner is required and must be one of: ${ACCOUNT_OWNERS.join(', ')}` }, { status: 400 });
  }
  const itemOwner: string = owner;

  const client = getPlaidClient();
  const exch = await client.itemPublicTokenExchange({ public_token });
  const accessToken = exch.data.access_token;
  const plaidItemId = exch.data.item_id;

  const acctResp = await client.accountsGet({ access_token: accessToken });

  // Resolve the real institution name from the Item's institution_id (null for
  // Same-Day Micro-deposit Items); fall back to a generic label if unavailable.
  const institutionId = acctResp.data.item.institution_id;
  let institutionName = 'Bank';
  if (institutionId) {
    try {
      const inst = await client.institutionsGetById({
        institution_id: institutionId,
        country_codes: getPlaidCountryCodes(),
      });
      institutionName = inst.data.institution.name;
    } catch {
      // Keep the fallback name if the institutions lookup fails.
    }
  }

  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.insert(schema.plaidItems).values({
    id, plaidItemId, institutionName, owner: itemOwner,
    accessToken: encryptToken(accessToken), status: 'healthy',
    createdAt: now, modifiedAt: now,
  }).run();

  for (const a of acctResp.data.accounts) {
    // A deliberate reconnect is intent to have the account back: lift any prior
    // suppression so it is provisioned AND stops being skipped by background sync.
    // Suppression only blocks automatic re-adds, never an explicit reconnect.
    unsuppressPlaidAccount(a.account_id, db);
    await resolveOrCreateAccount({ ...mapPlaidAccount(a, institutionName, itemOwner), plaidItemId: id }, db);
  }

  // Fold each new account into the PDF history it continues, before the first
  // sync brings transactions in — otherwise the same real account stays split
  // across a statement row and a feed row, and the coverage grid reports the
  // statement row as missing every month since the connection.
  const merged = autoMergePlaidIntoHistory(id, db);
  await maybeSyncInvestmentsForItem(id, { client }, db);
  const savedItem = db.select().from(schema.plaidItems).where(eq(schema.plaidItems.id, id)).get();
  if (savedItem) {
    try {
      await syncInvestmentTransactions({ id: savedItem.id, accessToken: savedItem.accessToken }, { client }, db);
    } catch (err) {
      console.warn('[plaid] investment transactions sync failed after connect:', String(err));
    }
  }
  try {
    await classifyUntaggedSecurities(db, { apiKey: request.headers.get('x-anthropic-api-key') ?? undefined });
  } catch (err) {
    console.warn('[plaid] security classification failed after connect:', String(err));
  }
  return NextResponse.json({
    ok: true,
    accounts: acctResp.data.accounts.length,
    merged: merged.map((m) => m.display),
  });
}
