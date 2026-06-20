import { prepareLLMRequest } from './client.js'
import {
  builtinProviders,
  createCustomOpenAICompatibleProvider,
  createDeepSeekProvider,
  createMiniMaxChinaTokenPlanProvider,
  createOpenAIProvider,
} from './providers.js'
import type { LLMRequest, PreparedRequest } from './types.js'

const demoPrompt = 'Reply with one short sentence: model layer demo is working.'

export function createDemoRequests(): LLMRequest[] {
  return [
    {
      model: { provider: createDeepSeekProvider() },
      prompt: demoPrompt,
      temperature: 0,
      maxTokens: 128,
    },
    {
      model: { provider: createMiniMaxChinaTokenPlanProvider() },
      prompt: demoPrompt,
      temperature: 0.2,
      maxTokens: 128,
      providerOptions: {
        minimax: {
          thinking: { type: 'adaptive' },
        },
      },
    },
    {
      model: { provider: createOpenAIProvider('api-key') },
      prompt: demoPrompt,
      temperature: 0,
      maxTokens: 128,
    },
    {
      model: { provider: createOpenAIProvider('codex') },
      prompt: demoPrompt,
      temperature: 0,
      maxTokens: 128,
    },
    {
      model: {
        provider: createCustomOpenAICompatibleProvider({
          baseURL: 'https://example.test/v1',
          model: 'custom-model',
          apiKeyEnv: 'CUSTOM_LLM_API_KEY',
        }),
      },
      prompt: demoPrompt,
      temperature: 0,
      maxTokens: 128,
    },
  ]
}

export function createOfflineDemoPreparedRequests(): PreparedRequest[] {
  return createDemoRequests().map((request) =>
    prepareLLMRequest(request, { includeAuth: false, requireAuth: false }),
  )
}

export { builtinProviders }
