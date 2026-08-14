import { NextResponse } from 'next/server';
import { listInvestmentAccounts } from '@/lib/investments/read';
import { createManualAccount, AccountExistsError } from '@/lib/accounts';
import { PURPOSES, type Purpose } from '@/lib/accountLifecycle';
import { ACCOUNT_OWNER_OPTIONS as OWNERS } from '@/lib/owners';

export async function GET() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    return NextResponse.json({ accounts: await listInvestmentAccounts(today) });
  } catch (error) {
    console.error('Error listing investment accounts:', error);
    return NextResponse.json({ error: 'Failed to list investment accounts' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      institution?: string; name?: string; owner?: string; purpose?: string;
    };
    if (!body.institution?.trim() || !body.name?.trim()) {
      return NextResponse.json({ error: 'institution and name are required' }, { status: 400 });
    }
    if (body.owner !== undefined && !OWNERS.includes(body.owner)) {
      return NextResponse.json({ error: `owner must be one of: ${OWNERS.join(', ')}` }, { status: 400 });
    }
    if (body.purpose !== undefined && !(PURPOSES as readonly string[]).includes(body.purpose)) {
      return NextResponse.json({ error: `purpose must be one of: ${PURPOSES.join(', ')}` }, { status: 400 });
    }
    const account = await createManualAccount({
      institution: body.institution,
      name: body.name,
      owner: body.owner,
      purpose: body.purpose as (Purpose | undefined),
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    if (error instanceof AccountExistsError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Error creating investment account:', error);
    return NextResponse.json({ error: 'Failed to create investment account' }, { status: 500 });
  }
}
