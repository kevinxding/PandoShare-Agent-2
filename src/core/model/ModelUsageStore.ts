import { join } from 'node:path'
import { JsonlStore, RuntimePaths } from '../store/index.js'
import type { ModelUsageFilter, ModelUsageRecordV2 } from './ModelTypes.js'

export class ModelUsageStore {
  private readonly memory: ModelUsageRecordV2[] = []
  private readonly store?: JsonlStore<ModelUsageRecordV2>

  constructor(input: { workspaceRoot?: string; workspaceId?: string } = {}) {
    if (input.workspaceRoot) {
      const paths = new RuntimePaths({ workspaceRoot: input.workspaceRoot, workspaceId: input.workspaceId })
      this.store = new JsonlStore<ModelUsageRecordV2>(join(paths.root, 'model', 'usage.jsonl'))
    }
  }

  async append(record: ModelUsageRecordV2): Promise<void> {
    this.memory.push(record)
    await this.store?.append(record)
  }

  async read(filter: ModelUsageFilter = {}): Promise<ModelUsageRecordV2[]> {
    const records = this.store ? await this.store.readRecords() : this.memory
    return records.filter(record => {
      if (filter.providerId && record.providerId !== filter.providerId) return false
      if (filter.profileId && record.profileId !== filter.profileId) return false
      if (filter.runId && record.runId !== filter.runId) return false
      if (filter.loopId && record.loopId !== filter.loopId) return false
      if (filter.day && new Date(record.createdAtMs).toISOString().slice(0, 10) !== filter.day) return false
      return true
    })
  }
}