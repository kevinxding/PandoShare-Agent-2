import type { AgentConversationMessage } from '../agent/index.js'
import type { ProjectConfig } from '../config/index.js'
import { estimateMessages } from '../contextBuilder/index.js'
import type { ModelRef } from '../llm/types.js'

export type TokenBudgetOptions = {
  enabled?: boolean
  contextWindowTokens?: number
  reserveOutputTokens?: number
  charsPerToken?: number
  includeContextMessage?: boolean
  warningThresholdPercent?: number
}

export type TokenBudgetStats = {
  enabled: boolean
  provider: string
  model?: string
  contextWindowTokens?: number
  reserveOutputTokens: number
  maxInputTokens?: number
  estimatedInputTokens?: number
  estimatedTokensLeft?: number
  percentUsed?: number
  charsPerToken: number
  contextMessageIncluded: boolean
  warningThresholdPercent: number
  aboveWarningThreshold: boolean
  overBudget: boolean
}

export type TokenBudgetContextResult = {
  message?: AgentConversationMessage
  stats: TokenBudgetStats
}

type NormalizedTokenBudgetOptions = {
  enabled: boolean
  contextWindowTokens?: number
  reserveOutputTokens: number
  charsPerToken: number
  includeContextMessage: boolean
  warningThresholdPercent: number
}

const DEFAULT_CHARS_PER_TOKEN = 4
const DEFAULT_RESERVE_OUTPUT_TOKENS = 4_096
const DEFAULT_WARNING_THRESHOLD_PERCENT = 80

const PROVIDER_CONTEXT_WINDOWS: Record<string, number> = {
  openai: 128_000,
  'openai-codex': 128_000,
  deepseek: 64_000,
  'minimax-cn': 100_000,
  custom: 64_000,
}

export function buildTokenBudgetContext(input: {
  messages: readonly AgentConversationMessage[]
  model: ModelRef
  threadId?: string
  windowId?: number
  config?: ProjectConfig
  options?: TokenBudgetOptions
  reserveOutputTokens?: number
}): TokenBudgetContextResult {
  const options = normalizeOptions(input.config?.tokenBudget, input.options, input.reserveOutputTokens)
  const provider = input.model.provider.id
  const model = input.model.model ?? input.model.provider.defaultModel
  if (!options.enabled) {
    return {
      stats: disabledStats(provider, model, options),
    }
  }

  const contextWindowTokens = options.contextWindowTokens ?? PROVIDER_CONTEXT_WINDOWS[provider] ?? PROVIDER_CONTEXT_WINDOWS.custom
  const reserveOutputTokens = Math.min(options.reserveOutputTokens, Math.max(0, contextWindowTokens - 1))
  const maxInputTokens = Math.max(1, contextWindowTokens - reserveOutputTokens)
  const estimatedWithoutMessage = estimateTokensFromChars(estimateMessages(input.messages), options.charsPerToken)
  const draftMessage = options.includeContextMessage
    ? createTokenBudgetMessage({
        threadId: input.threadId,
        windowId: input.windowId,
        contextWindowTokens,
        maxInputTokens,
        estimatedInputTokens: estimatedWithoutMessage,
        estimatedTokensLeft: Math.max(0, maxInputTokens - estimatedWithoutMessage),
      })
    : undefined
  const estimatedInputTokens = draftMessage
    ? estimatedWithoutMessage + estimateTokensFromChars(estimateMessages([draftMessage]), options.charsPerToken)
    : estimatedWithoutMessage
  const estimatedTokensLeft = Math.max(0, maxInputTokens - estimatedInputTokens)
  const percentUsed = Math.min(999, Math.round((estimatedInputTokens / maxInputTokens) * 100))
  const stats: TokenBudgetStats = {
    enabled: true,
    provider,
    model,
    contextWindowTokens,
    reserveOutputTokens,
    maxInputTokens,
    estimatedInputTokens,
    estimatedTokensLeft,
    percentUsed,
    charsPerToken: options.charsPerToken,
    contextMessageIncluded: Boolean(draftMessage),
    warningThresholdPercent: options.warningThresholdPercent,
    aboveWarningThreshold: percentUsed >= options.warningThresholdPercent,
    overBudget: estimatedInputTokens > maxInputTokens,
  }

  const message = draftMessage
    ? createTokenBudgetMessage({
        threadId: input.threadId,
        windowId: input.windowId,
        contextWindowTokens,
        maxInputTokens,
        estimatedInputTokens,
        estimatedTokensLeft,
      })
    : undefined

  return {
    message,
    stats: {
      ...stats,
      contextMessageIncluded: Boolean(message),
    },
  }
}

function normalizeOptions(
  config: TokenBudgetOptions | undefined,
  override: TokenBudgetOptions | undefined,
  reserveOutputTokens: number | undefined,
): NormalizedTokenBudgetOptions {
  return {
    enabled: override?.enabled ?? config?.enabled ?? true,
    contextWindowTokens: override?.contextWindowTokens ?? config?.contextWindowTokens,
    reserveOutputTokens: override?.reserveOutputTokens ?? config?.reserveOutputTokens ?? reserveOutputTokens ?? DEFAULT_RESERVE_OUTPUT_TOKENS,
    charsPerToken: override?.charsPerToken ?? config?.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN,
    includeContextMessage: override?.includeContextMessage ?? config?.includeContextMessage ?? true,
    warningThresholdPercent: override?.warningThresholdPercent ?? config?.warningThresholdPercent ?? DEFAULT_WARNING_THRESHOLD_PERCENT,
  }
}

function disabledStats(
  provider: string,
  model: string,
  options: NormalizedTokenBudgetOptions,
): TokenBudgetStats {
  return {
    enabled: false,
    provider,
    model,
    reserveOutputTokens: options.reserveOutputTokens,
    charsPerToken: options.charsPerToken,
    contextMessageIncluded: false,
    warningThresholdPercent: options.warningThresholdPercent,
    aboveWarningThreshold: false,
    overBudget: false,
  }
}

function createTokenBudgetMessage(input: {
  threadId?: string
  windowId?: number
  contextWindowTokens: number
  maxInputTokens: number
  estimatedInputTokens: number
  estimatedTokensLeft: number
}): AgentConversationMessage {
  return {
    role: 'user',
    content: [
      '<token_budget>',
      input.threadId ? `Thread id ${input.threadId}.` : undefined,
      input.windowId !== undefined ? `Current context window ${input.windowId}.` : undefined,
      `Context window: ${input.contextWindowTokens} tokens.`,
      `Max input budget after output reserve: ${input.maxInputTokens} tokens.`,
      `Estimated input tokens already used: ${input.estimatedInputTokens}.`,
      `Estimated tokens left in this context window: ${input.estimatedTokensLeft}.`,
      '</token_budget>',
    ].filter((line): line is string => Boolean(line)).join('\n'),
  }
}

function estimateTokensFromChars(chars: number, charsPerToken: number): number {
  return Math.max(1, Math.ceil(chars / Math.max(1, charsPerToken)))
}
