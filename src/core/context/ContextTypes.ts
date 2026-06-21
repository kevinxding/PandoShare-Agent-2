export type ContextProfile = 'plan' | 'build' | 'gui' | 'verifier'
export type ContextSource = 'message' | 'system' | 'evidence' | 'tool_result' | 'memory' | 'compaction' | 'summary'

export type ContextProvenance = {
  source: ContextSource
  sourceId: string
  reason: string
  priority: number
  tags?: string[]
}

export type ContextFragment = {
  fragmentId: string
  kind: ContextSource
  content: string
  estimatedTokens: number
  provenance: ContextProvenance
  protected?: boolean
}

export type EvidencePack = {
  evidenceId: string
  title: string
  refs: Array<{ kind: 'replay' | 'tool' | 'gui' | 'gateway' | 'model' | 'file'; ref: string; summary?: string }>
  summary: string
  provenance: ContextProvenance
}

export type ContextPack = {
  contextId: string
  profile: ContextProfile
  messages: ContextFragment[]
  systemInstructions: ContextFragment[]
  evidencePacks: EvidencePack[]
  toolResultRefs: ContextFragment[]
  memorySnippets: ContextFragment[]
  compactionSummaries: ContextFragment[]
  estimatedTokens: number
  budgetTokens: number
  provenance: ContextProvenance[]
  audit: Array<{ fragmentId: string; decision: 'included' | 'dropped'; reason: string }>
}

export type ContextRuntimeInput = {
  threadId?: string
  runId?: string
  goalId?: string
  loopId?: string
  taskId?: string
  profile?: ContextProfile
  budgetTokens?: number
  fragments?: ContextFragment[]
  evidencePacks?: EvidencePack[]
}
