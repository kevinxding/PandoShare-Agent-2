import { resolveDefaultModel, type ProjectConfig } from '../config/index.js'
import { generateText, prepareLLMRequest } from './client.js'
import type { ChatContent, LLMRequest, LLMResponse, PreparedRequest, ProviderCapabilities } from './types.js'

export type ModelSmokeInput = {
  config?: ProjectConfig
  provider?: string
  model?: string
  prompt?: ChatContent
  online?: boolean
  maxTokens?: number
  temperature?: number
  providerOptions?: Record<string, Record<string, unknown> | undefined>
}

export type SafePreparedRequest = Omit<PreparedRequest, 'headers'> & {
  headerNames: readonly string[]
}

export type ModelSmokeResponse = {
  provider: string
  model: string
  text: string
  hasUsage: boolean
}

export type ModelSmokeResult = {
  mode: 'offline' | 'online'
  prepared: SafePreparedRequest
  capabilities: ProviderCapabilities
  response?: ModelSmokeResponse
}

const DEFAULT_SMOKE_PROMPT = 'Say OK in English.'

export function createModelSmokeRequest(input: ModelSmokeInput = {}): LLMRequest {
  const config = applyModelOverrides(input.config ?? {}, input)
  const model = resolveDefaultModel(config)
  return {
    model,
    prompt: input.prompt ?? DEFAULT_SMOKE_PROMPT,
    temperature: input.temperature ?? 0,
    maxTokens: input.maxTokens ?? 32,
    providerOptions: mergeProviderOptions(defaultSmokeProviderOptions(model.provider.id), input.providerOptions),
  }
}

export async function runModelSmoke(input: ModelSmokeInput = {}): Promise<ModelSmokeResult> {
  const request = createModelSmokeRequest(input)
  const online = input.online ?? false
  const prepared = prepareLLMRequest(request, {
    includeAuth: online,
    requireAuth: online,
  })

  if (!online) {
    return {
      mode: 'offline',
      prepared: safePreparedRequest(prepared),
      capabilities: request.model.provider.capabilities,
    }
  }

  const response = await generateText(request)
  return {
    mode: 'online',
    prepared: safePreparedRequest(prepared),
    capabilities: request.model.provider.capabilities,
    response: safeResponse(response),
  }
}

export function safePreparedRequest(prepared: PreparedRequest): SafePreparedRequest {
  const { headers, ...rest } = prepared
  return {
    ...rest,
    headerNames: Object.keys(headers),
  }
}

function safeResponse(response: LLMResponse): ModelSmokeResponse {
  return {
    provider: response.provider,
    model: response.model,
    text: response.text,
    hasUsage: response.usage !== undefined,
  }
}

function applyModelOverrides(config: ProjectConfig, input: ModelSmokeInput): ProjectConfig {
  if (!input.provider && !input.model) return config
  return {
    ...config,
    model: {
      ...config.model,
      provider: input.provider ?? config.model?.provider,
      name: input.model ?? config.model?.name,
    },
  }
}

function defaultSmokeProviderOptions(providerId: string): Record<string, Record<string, unknown> | undefined> | undefined {
  if (providerId !== 'minimax-cn') return undefined
  return {
    minimax: {
      thinking: { type: 'disabled' },
    },
  }
}

function mergeProviderOptions(
  base: Record<string, Record<string, unknown> | undefined> | undefined,
  patch: Record<string, Record<string, unknown> | undefined> | undefined,
): Record<string, Record<string, unknown> | undefined> | undefined {
  if (!base && !patch) return undefined
  const merged: Record<string, Record<string, unknown> | undefined> = { ...base }
  for (const [key, value] of Object.entries(patch ?? {})) {
    merged[key] = {
      ...(merged[key] ?? {}),
      ...(value ?? {}),
    }
  }
  return merged
}
