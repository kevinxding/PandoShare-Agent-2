import type { ContextProvenance, ContextSource } from './ContextTypes.js'

let provenanceCounter = 0

export function createContextProvenance(input: { source: ContextSource; sourceId?: string; reason: string; priority?: number; tags?: string[] }): ContextProvenance {
  provenanceCounter += 1
  return {
    source: input.source,
    sourceId: input.sourceId ?? input.source + '_' + provenanceCounter,
    reason: input.reason,
    priority: input.priority ?? 50,
    tags: input.tags,
  }
}
