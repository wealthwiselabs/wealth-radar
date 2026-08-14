import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { getPlaidEnv, getPlaidSecret, isPlaidConfigured } from './config';

let _client: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (!isPlaidConfigured()) throw new Error('Plaid is not configured.');
  if (_client) return _client;
  const config = new Configuration({
    basePath: PlaidEnvironments[getPlaidEnv()],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': getPlaidSecret(),
      },
    },
  });
  _client = new PlaidApi(config);
  return _client;
}
