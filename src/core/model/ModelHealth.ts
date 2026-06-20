import type { ModelProviderHealthRecord, ModelProviderHealthStatus } from './ModelTypes.js'

export type ModelHealthInput = {
  providerId: string
  modelId?: string
  status: ModelProviderHealthStatus
  message?: string
  retryAfterMs?: number
  rateLimitedUntilMs?: number
  updatedAtMs?: number
}

export class ModelHealth {
  private readonly health = new Map<string, ModelProviderHealthRecord>()

  set(providerId: string, status: ModelProviderHealthStatus, message?: string): void {
    this.update({ providerId, status, message })
  }

  update(input: ModelHealthInput): ModelProviderHealthRecord {
    const record: ModelProviderHealthRecord = {
      providerId: input.providerId,
      modelId: input.modelId,
      status: input.status,
      message: input.message,
      retryAfterMs: input.retryAfterMs,
      rateLimitedUntilMs: input.rateLimitedUntilMs,
      updatedAtMs: input.updatedAtMs ?? Date.now(),
    }
    this.health.set(key(input.providerId, input.modelId), record)
    return record
  }

  get(providerId: string, modelId?: string): ModelProviderHealthRecord {
    const record = this.health.get(key(providerId, modelId)) ?? this.health.get(key(providerId))
    if (!record) return { providerId, modelId, status: 'ok', updatedAtMs: 0 }
    if (record.status === 'rate_limited' && record.rateLimitedUntilMs !== undefined && record.rateLimitedUntilMs <= Date.now()) {
      return { providerId, modelId, status: 'ok', updatedAtMs: Date.now(), message: 'rate limit expired' }
    }
    return record
  }

  list(): ModelProviderHealthRecord[] {
    return [...this.health.values()].sort((left, right) => left.providerId.localeCompare(right.providerId))
  }

  isUsable(providerId: string, modelId?: string, options: { allowDegraded?: boolean; allowRateLimited?: boolean; allowMissingAuth?: boolean } = {}): boolean {
    const status = this.get(providerId, modelId).status
    if (status === 'ok') return true
    if (status === 'degraded') return options.allowDegraded ?? true
    if (status === 'rate_limited') return options.allowRateLimited ?? false
    if (status === 'missing_auth') return options.allowMissingAuth ?? false
    return false
  }
}

function key(providerId: string, modelId = ''): string {
  return `${providerId}:${modelId}`
}