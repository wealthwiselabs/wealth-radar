import { KNOWLEDGE_MANIFEST } from '../knowledge/manifest';
import type { Tool } from './types';

export const loadKnowledgeTool: Tool = {
  gate: 'none',
  spec: {
    name: 'load_knowledge',
    description: `Load an advisor knowledge doc. Topics: ${KNOWLEDGE_MANIFEST.map((k) => k.topic).join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The knowledge topic to load, e.g. portfolio-allocation.' },
      },
      required: ['topic'],
      additionalProperties: false,
    },
  },
  async run(input: { topic: string }) {
    const doc = KNOWLEDGE_MANIFEST.find((k) => k.topic === input.topic);
    return doc
      ? { content: doc.body }
      : { content: `Unknown topic. Available: ${KNOWLEDGE_MANIFEST.map((k) => k.topic).join(', ')}`, isError: true };
  },
};
