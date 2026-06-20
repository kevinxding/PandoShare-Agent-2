import type { ProviderDefinition } from '../../services/llm/types.js'

export type ModelProviderId = string
export type ModelId = string
export type ModelProfileId =
  | 'build'
  | 'plan'
  | 'gui'
  | 'loop'
  | 'verifier'
  | 'repair'
  | 'gateway'
  | 'compact'
  | 'replay'
  | 'cheap'
  | string

export type ModelTaskType =
  | 'code'
  | 'plan'
  | 'review'
  | 'repair'
  | 'test'
  | 'gui'
  | 'vision'
  | 'loop'
  | 'verifier'
  | 'gateway_reply'
  | 'summarizer'
  | 'compactor'
  | 'replay_audit'
  | 'cheap'
  | 'long_context'
  | 'embedding_optional'

export type ModelRegion = 'global' | 'cn' | 'local' | 'custom'
export type ModelPrivacyClass = 'local' | 'first_party' | 'third_party' | 'custom'
export type ModelLatencyClass = 'low' | 'medium' | 'high' | 'unknown'
export type ModelCostClass = 'free' | 'cheap' | 'standard' | 'expensive' | 'unknown'
export type ModelFunctionCallingStyle = 'openai_tools' | 'openai_functions' | 'none' | 'unknown'

export type ModelCapabilitySet = {
  tools: boolean
  vision: boolean
  streaming: boolean
  reasoning: boolean
  jsonMode: boolean
  longContext: boolean
  contextWindowTokens: number
  maxOutputTokens?: number
  functionCallingStyle: ModelFunctionCallingStyle
  supportsSystemPrompt: boolean
  supportsImageInput: boolean
  supportsToolChoice: boolean
  supportsParallelTools: boolean
  supportsStreamingTools?: boolean
  local: boolean
  region?: ModelRegion
  privacyClass: ModelPrivacyClass
  latencyClass?: ModelLatencyClass
  costClass?: ModelCostClass
}

export type ModelCapabilities = Pick<ModelCapabilitySet, 'tools' | 'vision' | 'longContext' | 'reasoning' | 'streaming'>

export type ModelProviderRecord = {
  providerId: ModelProviderId
  displayName: string
  provider: ProviderDefinition
  configured: boolean
  missingAuth: boolean
  missingAuthEnv?: readonly string[]
  region: ModelRegion
  privacyClass: ModelPrivacyClass
  costClass: ModelCostClass
  latencyClass: ModelLatencyClass
}

export type ModelRouteCandidate = {
  providerId: ModelProviderId
  modelId: ModelId
  provider: ProviderDefinition
  displayName: string
  capabilities: ModelCapabilitySet
  health: ModelProviderHealthRecord
  configured: boolean
  missingAuth: boolean
  costClass: ModelCostClass
  region: ModelRegion
  privacyClass: ModelPrivacyClass
  score: number
  scoreReasons: string[]
}

export type RejectedModelCandidate = {
  providerId: ModelProviderId
  modelId: ModelId
  reasons: string[]
}

export type ModelRouteReason = {
  code: string
  message: string
  weight?: number
}

export type ModelBudgetPolicy = {
  scope?: 'run' | 'thread' | 'loop' | 'gateway' | 'daily' | 'provider' | 'profile'
  maxInputTokens?: number
  maxOutputTokens?: number
  maxTotalTokens?: number
  maxEstimatedCost?: number
  warnAtRatio?: number
  hardLimit?: boolean
}

export type ModelBudgetDecision = {
  status: 'ok' | 'warning' | 'exceeded' | 'unknown'
  reason: string
  estimatedInputTokens?: number
  estimatedOutputTokens?: number
  estimatedTotalTokens?: number
  estimatedCost?: number
  warnAtRatio?: number
  hardLimit?: boolean
}

export type ModelFallbackPlan = {
  enabled: boolean
  maxFallbacks: number
  candidates: ModelRouteCandidate[]
  reasons: string[]
}

export type ModelRoutingPolicy = {
  preferredProvider?: string
  preferredModel?: string
  allowedProviders?: readonly string[]
  deniedProviders?: readonly string[]
  allowedModels?: readonly string[]
  deniedModels?: readonly string[]
  requiredCapabilities?: Partial<Record<keyof ModelCapabilitySet, boolean | number | string>>
  preferredCapabilities?: Partial<Record<keyof ModelCapabilitySet, boolean | number | string>>
  maxCostClass?: ModelCostClass
  privacyRequirement?: ModelPrivacyClass
  regionPreference?: ModelRegion
  fallbackEnabled?: boolean
  fallbackOrder?: readonly string[]
  budgetPolicy?: ModelBudgetPolicy
  healthPolicy?: {
    allowDegraded?: boolean
    allowRateLimited?: boolean
    allowMissingAuth?: boolean
  }
  sameFamilyAvoidanceForVerifier?: boolean
  contextTokensNeeded?: number
  estimatedOutputTokens?: number
  riskLevel?: 'low' | 'medium' | 'high'
}

export type ModelProfile = {
  profileId: ModelProfileId
  taskType: ModelTaskType
  description: string
  policy: ModelRoutingPolicy
}

export type ModelRouteRequestV2 = ModelRoutingPolicy & {
  workspaceId?: string
  routeId?: string
  profileId?: ModelProfileId
  taskType: ModelTaskType
  sourceProviderId?: string
  sourceModelId?: string
  runId?: string
  threadId?: string
  loopId?: string
  gatewayId?: string
  requireCapabilities?: Partial<Record<keyof ModelCapabilitySet, boolean | number | string>>
  allowRateLimited?: boolean
}

export type ModelRouteDecision = {
  routeId: string
  workspaceId: string
  profileId?: ModelProfileId
  taskType: ModelTaskType
  selectedProviderId?: ModelProviderId
  selectedModelId?: ModelId
  selected?: ModelRouteCandidate
  candidateCount: number
  rejectedCandidates: RejectedModelCandidate[]
  requiredCapabilities: Partial<Record<keyof ModelCapabilitySet, boolean | number | string>>
  matchedCapabilities: Partial<ModelCapabilitySet>
  missingCapabilities?: string[]
  fallbackPlan: ModelFallbackPlan
  budgetDecision: ModelBudgetDecision
  healthDecision: string
  routeReason: ModelRouteReason[]
  status: 'selected' | 'rejected'
  createdAtMs: number
  eventIds: string[]
}

export type ModelRouteRequest = {
  taskType: ModelTaskType
  preferredProvider?: string
  preferredModel?: string
}

export type RoutedModel = {
  provider: ProviderDefinition
  model: string
  capabilities: ModelCapabilities
  routeDecision?: ModelRouteDecision
}

export type ModelProviderHealthStatus =
  | 'ok'
  | 'degraded'
  | 'rate_limited'
  | 'auth_failed'
  | 'unavailable'
  | 'context_limited'
  | 'missing_auth'
  | 'unknown'

export type ModelProviderHealthRecord = {
  providerId: string
  modelId?: string
  status: ModelProviderHealthStatus
  message?: string
  retryAfterMs?: number
  rateLimitedUntilMs?: number
  updatedAtMs: number
}

export type ModelUsageRecordV2 = {
  usageId: string
  workspaceId: string
  routeId?: string
  runId?: string
  threadId?: string
  loopId?: string
  gatewayId?: string
  profileId?: string
  taskType: ModelTaskType
  providerId: string
  modelId: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  estimatedCost?: number
  createdAtMs: number
}

export type ModelUsageRecord = ModelUsageRecordV2 & {
  provider?: string
  model?: string
}

export type ModelUsageFilter = {
  providerId?: string
  profileId?: string
  runId?: string
  loopId?: string
  day?: string
}
