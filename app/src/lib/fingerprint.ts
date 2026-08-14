import { createHash } from 'crypto';

export function transactionFingerprint(input: {
  accountId: string;
  date: string;
  description: string;
  amount: number;
}): string {
  const normDesc = input.description.trim().toLowerCase().replace(/\s+/g, ' ');
  const key = `${input.accountId}|${input.date}|${normDesc}|${input.amount}`;
  return createHash('sha1').update(key).digest('hex');
}
