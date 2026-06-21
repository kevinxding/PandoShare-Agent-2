import type { MemoryQuery, MemoryRecord } from './MemoryTypes.js'
import { MemoryStore } from './MemoryStore.js'

export class MemoryRetrieval {
  constructor(private readonly store: MemoryStore) {}
  retrieve(query: MemoryQuery): Promise<MemoryRecord[]> { return this.store.read(query) }
}
