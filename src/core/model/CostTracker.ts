import { createProtocolId } from '../protocol/index.js'
import { ModelUsageStore } from './ModelUsageStore.js'
import type { ModelUsageFilter, ModelUsageRecord, ModelUsageRecordV2 } from './ModelTypes.js'

export class CostTracker {
  private readonly usageStore: ModelUsageStore

  constructor(input: { workspaceRoot?: string; workspaceId?: string; usageStore?: ModelUsageStore } = {}) {
    this.usageStore = input.usageStore ?? new ModelUsageStore(input)
  }

  async recordUsage(record: ModelUsageRecord): Promise<void> {
    const providerId = record.providerId ?? record.provider
    const modelId = record.modelId ?? record.model
    if (!providerId || !modelId) throw new Error('Model usage requires providerId/modelId')
    await this.usageStore.append({
      usageId: record.usageId ?? createProtocolId('usage'),
      workspaceId: record.workspaceId ?? 'default',
      routeId: record.routeId,
      runId: record.runId,
      threadId: record.threadId,
      loopId: record.loopId,
      gatewayId: record.gatewayId,
      profileId: record.profileId,
      taskType: record.taskType ?? 'code',
      providerId,
      modelId,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      totalTokens: record.totalTokens ?? total(record.inputTokens, record.outputTokens),
      estimatedCost: record.estimatedCost,
      createdAtMs: record.createdAtMs ?? Date.now(),
    })
  }

  async readUsage(filter: ModelUsageFilter = {}): Promise<ModelUsageRecordV2[]> {
    return this.usageStore.read(filter)
  }
}

function total(inputTokens?: number, outputTokens?: number): number | undefined {
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return (inputTokens ?? 0) + (outputTokens ?? 0)
}