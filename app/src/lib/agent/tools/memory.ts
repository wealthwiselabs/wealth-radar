import { saveMemory } from '@/lib/agent/memory';
import type { Tool } from './types';

export const saveMemoryTool: Tool = {
  gate: 'none',
  spec: {
    name: 'save_memory',
    description:
      'Durably record a user-specific profile fact so future conversations remember it (e.g. after the ' +
      'user states a goal, constraint, or preference). Suggested keys: goals, target_retirement_age, ' +
      'job_security, risk_tolerance, dependents — but any short snake_case key describing the fact is fine.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short snake_case key identifying the fact, e.g. risk_tolerance.' },
        value: { type: 'string', description: 'The fact to remember, in plain text.' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
  },
  async run({ key, value }: { key: string; value: string }, { db }) {
    await saveMemory(key, value, db);
    return { content: `Remembered ${key}: ${value}` };
  },
};
