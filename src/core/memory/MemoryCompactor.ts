import type { MemoryRecord } from './MemoryTypes.js'

export class MemoryCompactor {
  compact(records: readonly MemoryRecord[]): string {
    return records.map(record => '[' + record.scope + '] ' + record.content).join('\n')
  }
}
