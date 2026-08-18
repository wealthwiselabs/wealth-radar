import { createAnthropicProvider } from './anthropic';
import { createOpenAIProvider } from './openai';
import type { AgentConfig } from '@/lib/agent/systemPrompt';
import type { LLMProvider } from './types';

export function createProvider(cfg: AgentConfig): LLMProvider {
  return cfg.provider === 'openai'
    ? createOpenAIProvider({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })
    : createAnthropicProvider({ apiKey: cfg.apiKey });
}
