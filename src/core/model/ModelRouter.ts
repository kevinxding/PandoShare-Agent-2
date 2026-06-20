import { LLMProviderError } from '../../services/llm/client.js'
import type { ProjectConfig } from '../../services/config/index.js'
import type { DurableRuntime } from '../durable/index.js'
import { createEventEnvelope, createProtocolId, type EventEnvelope } from '../protocol/index.js'
import { capabilityScore, mergeRequiredCapabilities, missingCapabilities } from './CapabilityGraph.js'
import { FallbackPlanner } from './FallbackPlanner.js'
import { ModelBudget, estimateCost } from './ModelBudget.js'
import { ModelCatalog } from './ModelCatalog.js'
import { MODEL_EVENT_TYPES } from './ModelEventTypes.js'
import { ModelHealth, type ModelHealthInput } from './ModelHealth.js'
import { getModelProfile, listModelProfiles, mergeProfilePolicy, profileForTask } from './ModelProfiles.js'
import { costScore, providerAllowed } from './ModelRoutingPolicy.js'
import { ModelUsageStore } from './ModelUsageStore.js'
import { ProviderRegistry } from './ProviderRegistry.js'
import type {
  ModelBudgetDecision,
  ModelProfile,
  ModelProviderHealthRecord,
  ModelProviderHealthStatus,
  ModelRouteCandidate,
  ModelRouteDecision,
  ModelRouteReason,
  ModelRouteRequest,
  ModelRouteRequestV2,
  ModelRoutingPolicy,
  ModelTaskType,
  ModelUsageFilter,
  ModelUsageRecordV2,
  RejectedModelCandidate,
  RoutedModel,
} from './ModelTypes.js'

export type ModelRouterOptions = {
  workspaceId?: string
  workspaceRoot?: string
  durable?: DurableRuntime
  health?: ModelHealth
  usageStore?: ModelUsageStore
  now?: () => number
}

export class ModelRouter {
  readonly health: ModelHealth
  private readonly workspaceId: string
  private readonly durable?: DurableRuntime
  private readonly usageStore: ModelUsageStore
  private readonly budget = new ModelBudget()
  private readonly fallbackPlanner = new FallbackPlanner()
  private readonly memoryEvents: EventEnvelope[] = []
  private readonly now: () => number

  constructor(private readonly registry: ProviderRegistry, options: ModelRouterOptions = {}) {
    this.workspaceId = options.workspaceId ?? 'default'
    this.durable = options.durable
    this.health = options.health ?? new ModelHealth()
    this.usageStore = options.usageStore ?? new ModelUsageStore({ workspaceRoot: options.workspaceRoot, workspaceId: this.workspaceId })
    this.now = options.now ?? (() => Date.now())
  }

  static fromConfig(config: ProjectConfig = {}, options: ModelRouterOptions = {}): ModelRouter {
    return new ModelRouter(new ProviderRegistry(config), options)
  }

  selectModel(request: ModelRouteRequest): RoutedModel {
    const decision = this.evaluateRoute({ ...request, taskType: request.taskType })
    if (!decision.selected) {
      throw new Error(`No usable model provider for task ${request.taskType}: ${decision.routeReason.map(reason => reason.message).join('; ')}`)
    }
    return {
      provider: decision.selected.provider,
      model: decision.selected.modelId,
      capabilities: decision.selected.capabilities,
      routeDecision: decision,
    }
  }

  async route(request: ModelRouteRequestV2): Promise<ModelRouteDecision> {
    const normalized = this.normalizeRequest(request)
    const routeStarted = await this.emit(MODEL_EVENT_TYPES.routeRequested, normalized, {
      routeId: normalized.routeId,
      profileId: normalized.profileId,
      taskType: normalized.taskType,
      preferredProvider: normalized.preferredProvider,
      preferredModel: normalized.preferredModel,
      requiredCapabilities: normalized.requiredCapabilities ?? normalized.requireCapabilities,
      contextTokensNeeded: normalized.contextTokensNeeded,
    })
    const decision = this.evaluateRoute(normalized)
    decision.eventIds.push(routeStarted.eventId)
    if (decision.budgetDecision.status === 'warning') {
      decision.eventIds.push((await this.emit(MODEL_EVENT_TYPES.budgetWarning, normalized, compactBudget(decision))).eventId)
    }
    if (decision.budgetDecision.status === 'exceeded') {
      decision.eventIds.push((await this.emit(MODEL_EVENT_TYPES.budgetExceeded, normalized, compactBudget(decision))).eventId)
    }
    if (decision.fallbackPlan.enabled && decision.fallbackPlan.candidates.length) {
      decision.eventIds.push((await this.emit(MODEL_EVENT_TYPES.fallbackPlanned, normalized, compactFallback(decision))).eventId)
    }
    decision.eventIds.push((await this.emit(decision.selected ? MODEL_EVENT_TYPES.routeSelected : MODEL_EVENT_TYPES.routeRejected, normalized, compactDecision(decision))).eventId)
    return decision
  }

  explainRoute(request: ModelRouteRequestV2): ModelRouteDecision {
    return this.evaluateRoute(request)
  }

  async planFallback(decision: ModelRouteDecision, reason = 'request_failed'): Promise<ModelRouteCandidate | undefined> {
    const candidate = decision.fallbackPlan.candidates[0]
    await this.emit(candidate ? MODEL_EVENT_TYPES.fallbackSelected : MODEL_EVENT_TYPES.fallbackExhausted, decision, {
      routeId: decision.routeId,
      reason,
      selectedProviderId: candidate?.providerId,
      selectedModelId: candidate?.modelId,
      candidates: decision.fallbackPlan.candidates.map(candidateSummary),
    })
    return candidate
  }

  async recordRequestStarted(decision: ModelRouteDecision): Promise<void> {
    await this.emit(MODEL_EVENT_TYPES.requestStarted, decision, compactDecision(decision))
  }

  async recordResponseCompleted(decision: ModelRouteDecision, usage: unknown): Promise<void> {
    await this.recordUsage(decision, usageRecordFromResponse(decision, usage, this.now()))
    await this.emit(MODEL_EVENT_TYPES.responseCompleted, decision, {
      ...compactDecision(decision),
      usage: safeUsage(usage),
    })
  }

  async recordRequestFailed(decision: ModelRouteDecision, error: unknown): Promise<void> {
    const status = statusFromError(error)
    const selected = decision.selected
    let healthRecord: ModelProviderHealthRecord | undefined
    if (selected) {
      healthRecord = this.updateHealth({
        providerId: selected.providerId,
        modelId: selected.modelId,
        status,
        message: errorMessage(error),
        retryAfterMs: error instanceof LLMProviderError ? error.retryAfterMs : undefined,
        rateLimitedUntilMs: error instanceof LLMProviderError && error.retryAfterMs ? this.now() + error.retryAfterMs : undefined,
      })
    }
    await this.emit(status === 'rate_limited' ? MODEL_EVENT_TYPES.rateLimited : MODEL_EVENT_TYPES.requestFailed, decision, {
      ...compactDecision(decision),
      status,
      message: errorMessage(error),
      retryAfterMs: error instanceof LLMProviderError ? error.retryAfterMs : undefined,
    })
    if (healthRecord) {
      await this.emit(MODEL_EVENT_TYPES.providerHealthChanged, decision, healthRecord)
    }
  }

  async recordUsage(decision: ModelRouteDecision, usage: ModelUsageRecordV2): Promise<void> {
    await this.usageStore.append(usage)
    await this.emit(MODEL_EVENT_TYPES.usageRecorded, decision, usage)
  }

  listProviders() {
    return new ModelCatalog(this.registry, this.health).listProviders()
  }

  listModels(): ModelRouteCandidate[] {
    return new ModelCatalog(this.registry, this.health).listCandidates()
  }

  listProfiles(): ModelProfile[] {
    return listModelProfiles()
  }

  readHealth(): ModelProviderHealthRecord[] {
    return this.health.list()
  }

  updateHealth(input: ModelHealthInput): ModelProviderHealthRecord {
    return this.health.update(input)
  }

  readUsage(filter: ModelUsageFilter = {}): Promise<ModelUsageRecordV2[]> {
    return this.usageStore.read(filter)
  }

  async readBudgetStatus(filter: ModelUsageFilter = {}): Promise<{ usage: ModelUsageRecordV2[]; totalTokens: number; estimatedCost: number }> {
    const usage = await this.readUsage(filter)
    return {
      usage,
      totalTokens: usage.reduce((sum, record) => sum + (record.totalTokens ?? 0), 0),
      estimatedCost: usage.reduce((sum, record) => sum + (record.estimatedCost ?? 0), 0),
    }
  }

  estimateCost(candidate: ModelRouteCandidate | undefined, totalTokens: number): number | undefined {
    return estimateCost(candidate, totalTokens)
  }

  readMemoryEvents(): EventEnvelope[] {
    return [...this.memoryEvents]
  }

  private normalizeRequest(request: ModelRouteRequestV2): ModelRouteRequestV2 {
    const profile = getModelProfile(request.profileId) ?? profileForTask(request.taskType)
    const policy = mergeProfilePolicy(profile, request)
    return {
      ...policy,
      ...request,
      routeId: request.routeId ?? createProtocolId('route'),
      workspaceId: request.workspaceId ?? this.workspaceId,
      profileId: request.profileId ?? profile?.profileId,
      taskType: request.taskType ?? profile?.taskType ?? 'code',
      fallbackEnabled: request.fallbackEnabled ?? policy.fallbackEnabled ?? true,
      requiredCapabilities: {
        ...policy.requiredCapabilities,
        ...request.requiredCapabilities,
      },
      preferredCapabilities: {
        ...policy.preferredCapabilities,
        ...request.preferredCapabilities,
      },
      budgetPolicy: {
        ...policy.budgetPolicy,
        ...request.budgetPolicy,
      },
      healthPolicy: {
        ...policy.healthPolicy,
        ...request.healthPolicy,
      },
    }
  }

  private evaluateRoute(input: ModelRouteRequestV2): ModelRouteDecision {
    const request = this.normalizeRequest(input)
    const catalog = new ModelCatalog(this.registry, this.health)
    const candidates = catalog.listCandidates()
    const requiredCapabilities = mergeRequiredCapabilities(request)
    const rejectedCandidates: RejectedModelCandidate[] = []
    const rankedCandidates: ModelRouteCandidate[] = []

    for (const candidate of candidates) {
      const rejectReasons = this.rejectReasons(candidate, request, requiredCapabilities, candidates)
      if (rejectReasons.length) {
        rejectedCandidates.push({ providerId: candidate.providerId, modelId: candidate.modelId, reasons: rejectReasons })
        continue
      }
      const scored = this.scoreCandidate(candidate, request)
      rankedCandidates.push(scored)
    }

    rankedCandidates.sort((left, right) => right.score - left.score || left.providerId.localeCompare(right.providerId))
    let selected: ModelRouteCandidate | undefined = rankedCandidates[0]
    let budgetDecision: ModelBudgetDecision = this.budget.decide({ request, candidate: selected })
    const routeReason: ModelRouteReason[] = []
    if (selected) {
      routeReason.push(...selected.scoreReasons.map(reason => ({ code: reason, message: reason })))
    }
    if (budgetDecision.status === 'exceeded' && budgetDecision.hardLimit !== false) {
      if (selected) rejectedCandidates.push({ providerId: selected.providerId, modelId: selected.modelId, reasons: [budgetDecision.reason] })
      selected = undefined
      routeReason.push({ code: budgetDecision.reason, message: budgetDecision.reason })
    }
    if (!selected) {
      routeReason.push({ code: 'no_model_selected', message: 'No provider satisfied route policy, health, capability, and budget constraints.' })
      budgetDecision = this.budget.decide({ request })
    }
    const fallbackPlan = this.fallbackPlanner.plan({
      request,
      selected,
      rankedCandidates,
      rejectedReasons: rejectedCandidates.flatMap(candidate => candidate.reasons),
    })
    return {
      routeId: request.routeId ?? createProtocolId('route'),
      workspaceId: request.workspaceId ?? this.workspaceId,
      profileId: request.profileId,
      taskType: request.taskType,
      selectedProviderId: selected?.providerId,
      selectedModelId: selected?.modelId,
      selected,
      candidateCount: candidates.length,
      rejectedCandidates,
      requiredCapabilities,
      matchedCapabilities: selected ? matchedCapabilities(selected, requiredCapabilities) : {},
      missingCapabilities: selected ? [] : [...new Set(rejectedCandidates.flatMap(candidate => candidate.reasons.filter(reason => reason.startsWith('missing_capability:'))))],
      fallbackPlan,
      budgetDecision,
      healthDecision: selected ? selected.health.status : 'no_healthy_candidate',
      routeReason,
      status: selected ? 'selected' : 'rejected',
      createdAtMs: this.now(),
      eventIds: [],
    }
  }

  private rejectReasons(
    candidate: ModelRouteCandidate,
    request: ModelRouteRequestV2,
    requiredCapabilities: Partial<Record<keyof ModelRouteCandidate['capabilities'], boolean | number | string>>,
    allCandidates: readonly ModelRouteCandidate[],
  ): string[] {
    const reasons: string[] = []
    const providerDenied = providerAllowed(candidate, request)
    if (providerDenied) reasons.push(providerDenied)
    const missing = missingCapabilities(candidate, requiredCapabilities, request.contextTokensNeeded)
    reasons.push(...missing.map(item => `missing_capability:${item}`))
    if (candidate.missingAuth && request.healthPolicy?.allowMissingAuth === false) reasons.push('missing_auth')
    if (!this.health.isUsable(candidate.providerId, candidate.modelId, request.healthPolicy)) reasons.push(`health_${candidate.health.status}`)
    if (request.sameFamilyAvoidanceForVerifier !== false && request.taskType === 'verifier' && request.sourceProviderId === candidate.providerId && allCandidates.length > 1) {
      reasons.push('same_family_for_verifier')
    }
    return reasons
  }

  private scoreCandidate(candidate: ModelRouteCandidate, request: ModelRouteRequestV2): ModelRouteCandidate {
    const capability = capabilityScore(candidate, request)
    const scoreReasons = [...capability.reasons]
    let score = capability.score + costScore(candidate.costClass)
    if (request.preferredProvider && candidate.providerId === request.preferredProvider) add(30, 'preferred_provider')
    if (request.preferredModel && candidate.modelId === request.preferredModel) add(20, 'preferred_model')
    if (request.regionPreference && candidate.region === request.regionPreference) add(4, 'region_preference')
    if (candidate.missingAuth) scoreReasons.push('missing_auth')
    if (candidate.health.status === 'ok') add(5, 'health_ok')
    if (candidate.health.status === 'degraded') add(-5, 'health_degraded')
    if (candidate.costClass === 'cheap' || candidate.costClass === 'free') scoreReasons.push('low_cost')
    return { ...candidate, score, scoreReasons }

    function add(weight: number, reason: string): void {
      score += weight
      scoreReasons.push(reason)
    }
  }

  private async emit(eventType: string, context: Partial<ModelRouteDecision | ModelRouteRequestV2>, payload: unknown): Promise<EventEnvelope> {
    const workspaceId = stringValue(context.workspaceId) ?? this.workspaceId
    const eventInput = {
      eventType,
      workspaceId,
      threadId: stringValue(recordPayload(context).threadId),
      runId: stringValue(recordPayload(context).runId),
      loopId: stringValue(recordPayload(context).loopId),
      payload,
    }
    if (this.durable) return this.durable.appendEvent(eventInput)
    const event = createEventEnvelope(eventInput)
    this.memoryEvents.push(event)
    return event
  }
}

function matchedCapabilities(candidate: ModelRouteCandidate, required: Partial<Record<keyof ModelRouteCandidate['capabilities'], boolean | number | string>>) {
  const matched: Partial<ModelRouteCandidate['capabilities']> = {}
  for (const key of Object.keys(required) as (keyof ModelRouteCandidate['capabilities'])[]) {
    ;(matched as Record<string, unknown>)[key] = candidate.capabilities[key]
  }
  return matched
}

function compactDecision(decision: ModelRouteDecision): Record<string, unknown> {
  return {
    routeId: decision.routeId,
    profileId: decision.profileId,
    taskType: decision.taskType,
    status: decision.status,
    selectedProviderId: decision.selectedProviderId,
    selectedModelId: decision.selectedModelId,
    candidateCount: decision.candidateCount,
    rejectedCandidateCount: decision.rejectedCandidates.length,
    routeReason: decision.routeReason,
    budgetDecision: decision.budgetDecision,
    fallbackCandidates: decision.fallbackPlan.candidates.map(candidateSummary),
  }
}

function compactFallback(decision: ModelRouteDecision): Record<string, unknown> {
  return {
    routeId: decision.routeId,
    selectedProviderId: decision.selectedProviderId,
    selectedModelId: decision.selectedModelId,
    candidates: decision.fallbackPlan.candidates.map(candidateSummary),
    reasons: decision.fallbackPlan.reasons,
  }
}

function compactBudget(decision: ModelRouteDecision): Record<string, unknown> {
  return {
    routeId: decision.routeId,
    profileId: decision.profileId,
    taskType: decision.taskType,
    providerId: decision.selectedProviderId,
    modelId: decision.selectedModelId,
    budgetDecision: decision.budgetDecision,
  }
}

function candidateSummary(candidate: ModelRouteCandidate): Record<string, unknown> {
  return {
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    score: candidate.score,
    health: candidate.health.status,
    costClass: candidate.costClass,
    region: candidate.region,
    privacyClass: candidate.privacyClass,
    capabilities: {
      tools: candidate.capabilities.tools,
      vision: candidate.capabilities.vision,
      reasoning: candidate.capabilities.reasoning,
      streaming: candidate.capabilities.streaming,
      longContext: candidate.capabilities.longContext,
      contextWindowTokens: candidate.capabilities.contextWindowTokens,
    },
  }
}

function usageRecordFromResponse(decision: ModelRouteDecision, usage: unknown, createdAtMs: number): ModelUsageRecordV2 {
  const usageRecord = recordPayload(usage)
  const inputTokens = numberValue(usageRecord, 'prompt_tokens') ?? numberValue(usageRecord, 'input_tokens')
  const outputTokens = numberValue(usageRecord, 'completion_tokens') ?? numberValue(usageRecord, 'output_tokens')
  const totalTokens = numberValue(usageRecord, 'total_tokens') ?? (inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined)
  return {
    usageId: createProtocolId('usage'),
    workspaceId: decision.workspaceId,
    routeId: decision.routeId,
    profileId: decision.profileId,
    taskType: decision.taskType,
    providerId: decision.selectedProviderId ?? 'unknown',
    modelId: decision.selectedModelId ?? 'unknown',
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost: totalTokens === undefined ? undefined : estimateCost(decision.selected, totalTokens),
    createdAtMs,
  }
}

function safeUsage(usage: unknown): unknown {
  if (!usage || typeof usage !== 'object') return usage
  const record = usage as Record<string, unknown>
  return Object.fromEntries(Object.entries(record).filter(([key]) => !/key|token|secret|authorization/i.test(key)))
}

function statusFromError(error: unknown): ModelProviderHealthStatus {
  if (error instanceof LLMProviderError) {
    if (error.category === 'auth_failed') return 'auth_failed'
    if (error.category === 'rate_limited') return 'rate_limited'
    if (error.category === 'context_too_long') return 'context_limited'
    if (error.category === 'network_error') return 'degraded'
    return 'unavailable'
  }
  return 'degraded'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function recordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}