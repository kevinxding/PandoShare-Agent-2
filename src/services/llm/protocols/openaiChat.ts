import type { ChatContent, ChatMessage, LLMRequest, LLMToolCall, LLMToolSpec, ProviderDefinition } from '../types.js'

export function openAIChatPath(baseURL: string): string {
  return `${trimTrailingSlash(baseURL)}/chat/completions`
}

export function buildOpenAIChatBody(request: LLMRequest): Record<string, unknown> {
  const provider = request.model.provider
  return compactObject({
    ...provider.defaultBody,
    model: request.model.model ?? provider.defaultModel,
    messages: buildMessages(request),
    tools: buildTools(request.tools),
    tool_choice: request.toolChoice,
    stream: request.stream ?? false,
    temperature: request.temperature,
    top_p: request.topP,
    max_completion_tokens: request.maxTokens,
    stop: request.stop,
    ...providerOptions(request, provider),
  })
}

export function parseOpenAIChatText(raw: unknown): string {
  const response = raw as {
    choices?: Array<{
      message?: {
        content?: unknown
        reasoning_content?: unknown
      }
      delta?: {
        content?: unknown
      }
    }>
  }
  const first = response.choices?.[0]
  const content = first?.message?.content ?? first?.delta?.content
  return typeof content === 'string' ? content : ''
}

export function parseOpenAIChatToolCalls(raw: unknown): LLMToolCall[] {
  const response = raw as {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{
          id?: unknown
          type?: unknown
          function?: {
            name?: unknown
            arguments?: unknown
          }
        }>
      }
    }>
  }
  const toolCalls = response.choices?.[0]?.message?.tool_calls ?? []
  return toolCalls.flatMap((toolCall, index) => {
    const name = toolCall.function?.name
    if (typeof name !== 'string' || !name) return []
    const rawInput = stringifyToolInput(toolCall.function?.arguments)
    return [
      {
        id: typeof toolCall.id === 'string' && toolCall.id ? toolCall.id : `call_${index}`,
        name,
        input: parseToolInput(rawInput),
        rawInput,
      },
    ]
  })
}

export function parseOpenAIChatUsage(raw: unknown): unknown {
  return (raw as { usage?: unknown }).usage
}

function buildMessages(request: LLMRequest): Record<string, unknown>[] {
  const messages: ChatMessage[] = []
  if (request.system) {
    messages.push({ role: 'system', content: request.system })
  }
  messages.push(...(request.messages ?? []))
  if (request.prompt !== undefined) {
    messages.push({ role: 'user', content: request.prompt })
  }
  return messages.map(buildMessage)
}

function buildMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return compactObject({
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: contentToText(message.content),
    })
  }

  return compactObject({
    role: message.role,
    content: message.content,
    name: message.name,
    tool_calls: buildToolCalls(message.toolCalls),
  })
}

function buildToolCalls(toolCalls: readonly LLMToolCall[] | undefined): unknown[] | undefined {
  if (!toolCalls?.length) return undefined
  return toolCalls.map(toolCall => ({
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: toolCall.rawInput ?? JSON.stringify(toolCall.input),
    },
  }))
}

function buildTools(tools: readonly LLMToolSpec[] | undefined): unknown[] | undefined {
  if (!tools?.length) return undefined
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? defaultInputSchema(),
    },
  }))
}

function providerOptions(request: LLMRequest, provider: ProviderDefinition): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const key of ['openaiCompatible', provider.id, ...(provider.optionKeys ?? [])]) {
    const value = request.providerOptions?.[key]
    if (!value) continue
    Object.assign(merged, value)
  }
  return merged
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function defaultInputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {},
    additionalProperties: true,
  }
}

function stringifyToolInput(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return '{}'
  return JSON.stringify(value)
}

function parseToolInput(value: string): Record<string, unknown> {
  try {
    const parsed = value ? JSON.parse(value) : {}
    return isRecord(parsed) ? parsed : { value: parsed }
  } catch {
    return { raw: value }
  }
}

function contentToText(content: ChatContent): string {
  if (typeof content === 'string') return content
  return content
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
