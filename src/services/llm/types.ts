export type ProviderId = 'openai' | 'openai-codex' | 'deepseek' | 'minimax-cn' | 'custom'

export type WireProtocol = 'openai-chat-completions' | 'openai-responses'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export type TextContentPart = {
  type: 'text'
  text: string
}

export type ImageContentPart = {
  type: 'image_url'
  image_url: {
    url: string
    detail?: 'low' | 'default' | 'high'
  }
}

export type VideoContentPart = {
  type: 'video_url'
  video_url: {
    url: string
    detail?: 'low' | 'default' | 'high'
  }
}

export type ChatContent = string | readonly (TextContentPart | ImageContentPart | VideoContentPart)[]

export type ChatMessage = {
  role: ChatRole
  content: ChatContent
  name?: string
  toolCallId?: string
  toolCalls?: readonly LLMToolCall[]
}

export type JSONSchema = Record<string, unknown>

export type LLMToolSpec = {
  name: string
  description: string
  inputSchema?: JSONSchema
}

export type LLMToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
  rawInput?: string
}

export type AuthConfig =
  | {
      type: 'none'
    }
  | {
      type: 'api-key'
      envKeys: readonly string[]
      token?: string
    }
  | {
      type: 'codex-access-token'
      envKeys: readonly string[]
      token?: string
      accountIdEnvKeys?: readonly string[]
      accountId?: string
    }

export type EnvHeaderConfig = {
  header: string
  envKeys: readonly string[]
}

export type ProviderCapabilities = {
  tools: boolean
  vision: boolean
  streaming: boolean
  reasoning: boolean
  contextWindowTokens: number
}

export type ProviderDefinition = {
  id: ProviderId | string
  name: string
  baseURL: string
  wireProtocol: WireProtocol
  defaultModel: string
  auth: AuthConfig
  capabilities: ProviderCapabilities
  defaultHeaders?: Record<string, string>
  envHeaders?: readonly EnvHeaderConfig[]
  defaultBody?: Record<string, unknown>
  optionKeys?: readonly string[]
}

export type ModelRef = {
  provider: ProviderDefinition
  model?: string
}

export type GenerationOptions = {
  temperature?: number
  topP?: number
  maxTokens?: number
  stop?: readonly string[]
}

export type LLMRequest = GenerationOptions & {
  model: ModelRef
  system?: string
  prompt?: ChatContent
  messages?: readonly ChatMessage[]
  tools?: readonly LLMToolSpec[]
  toolChoice?: 'auto' | 'none'
  stream?: boolean
  providerOptions?: Record<string, Record<string, unknown> | undefined>
  metadata?: Record<string, unknown>
}

export type PreparedRequest = {
  provider: string
  protocol: WireProtocol
  model: string
  method: 'POST'
  url: string
  headers: Record<string, string>
  redactedHeaders: Record<string, string>
  body: Record<string, unknown>
  missingAuthEnv?: readonly string[]
  authSource?: string
}

export type LLMResponse = {
  provider: string
  model: string
  text: string
  toolCalls?: readonly LLMToolCall[]
  usage?: unknown
  raw: unknown
}

export type LLMStreamEvent =
  | {
      type: 'text_delta'
      provider: string
      model: string
      delta: string
      raw?: unknown
    }
  | {
      type: 'completed'
      provider: string
      model: string
      text: string
      toolCalls?: readonly LLMToolCall[]
      usage?: unknown
      raw?: unknown
    }

export type LLMErrorCategory =
  | 'auth_failed'
  | 'rate_limited'
  | 'context_too_long'
  | 'network_error'
  | 'provider_invalid_response'
  | 'provider_error'

export type PrepareOptions = {
  includeAuth?: boolean
  requireAuth?: boolean
}

export type GenerateOptions = {
  fetch?: typeof fetch
  signal?: AbortSignal
  onRetry?: (event: GenerateRetryEvent) => void | Promise<void>
  retry?: false | {
    maxRetries?: number
    initialDelayMs?: number
    maxDelayMs?: number
    jitter?: boolean
  }
}

export type GenerateRetryEvent = {
  provider: string
  model: string
  attempt: number
  nextAttempt: number
  maxRetries: number
  delayMs: number
  category: LLMErrorCategory
  status?: number
  retryable: boolean
  message: string
}
