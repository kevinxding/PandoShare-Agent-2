import type { ProjectConfig } from '../../services/config/index.js'

export type ModelProbeType =
  | 'config'
  | 'auth_presence'
  | 'catalog_shape'
  | 'capability_static'
  | 'latency_mock'
  | 'online_minimal'
  | 'budget_estimate'
  | 'fallback_simulation'

export type ModelProbeStatus = 'passed' | 'skipped' | 'missing_auth' | 'degraded' | 'failed'

export type ModelProbeMode = 'offline' | 'online'

export type ModelProbeOptions = {
  config?: ProjectConfig
  workspaceRoot?: string
  workspaceId?: string
  outputDir?: string
  online?: boolean
  now?: () => number
}

export type ModelProbeProviderSummary = {
  providerId: string
  displayName: string
  configured: boolean
  authState: 'none' | 'configured' | 'missing_auth'
  missingAuth: boolean
  region: string
  privacyClass: string
  costClass: string
  latencyClass: string
}

export type ModelProbeModelSummary = {
  providerId: string
  modelId: string
  tools: boolean
  vision: boolean
  streaming: boolean
  reasoning: boolean
  longContext: boolean
  contextWindowTokens: number
  costClass: string
  latencyClass?: string
  privacyClass: string
  region?: string
}

export type ModelProbeProfileSummary = {
  profileId: string
  taskType: string
  fallbackEnabled: boolean
}

export type ModelProbeFallbackStep = {
  order: number
  providerId: string
  modelId: string
  role: 'selected' | 'fallback'
  score?: number
  health: string
}

export type ModelProbeResult = {
  id: string
  type: ModelProbeType
  status: ModelProbeStatus
  message: string
  startedAtMs: number
  completedAtMs: number
  durationMs: number
  providerId?: string
  modelId?: string
  data?: Record<string, unknown>
}

export type ModelProbeSummary = {
  status: 'passed' | 'partial' | 'failed'
  total: number
  passed: number
  skipped: number
  missingAuth: number
  degraded: number
  failed: number
}

export type ModelProbeRun = {
  runId: string
  createdAtMs: number
  completedAtMs: number
  durationMs: number
  mode: ModelProbeMode
  onlineEnabled: boolean
  workspaceId: string
  summary: ModelProbeSummary
  providers: ModelProbeProviderSummary[]
  models: ModelProbeModelSummary[]
  profiles: ModelProbeProfileSummary[]
  fallbackChain: ModelProbeFallbackStep[]
  results: ModelProbeResult[]
  partials: string[]
  reportFiles?: ModelProbeReportFiles
}

export type ModelProbeReportFiles = {
  jsonPath: string
  markdownPath: string
  jsonlPath: string
}

export type ModelProbeResultInput = Omit<ModelProbeResult, 'id' | 'completedAtMs' | 'durationMs'> & {
  completedAtMs?: number
}

export function createModelProbeResult(sequence: number, input: ModelProbeResultInput): ModelProbeResult {
  const completedAtMs = input.completedAtMs ?? input.startedAtMs
  return {
    ...input,
    id: `probe_${sequence}_${input.type}`,
    completedAtMs,
    durationMs: Math.max(0, completedAtMs - input.startedAtMs),
  }
}

export function summarizeModelProbeResults(results: readonly ModelProbeResult[]): ModelProbeSummary {
  const summary = {
    status: 'passed' as ModelProbeSummary['status'],
    total: results.length,
    passed: count(results, 'passed'),
    skipped: count(results, 'skipped'),
    missingAuth: count(results, 'missing_auth'),
    degraded: count(results, 'degraded'),
    failed: count(results, 'failed'),
  }
  if (summary.failed > 0) summary.status = 'failed'
  else if (summary.skipped > 0 || summary.missingAuth > 0 || summary.degraded > 0) summary.status = 'partial'
  return summary
}

function count(results: readonly ModelProbeResult[], status: ModelProbeStatus): number {
  return results.filter(result => result.status === status).length
}
