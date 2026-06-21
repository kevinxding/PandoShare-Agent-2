import type { GuiRecoveryDecisionKind, GuiRuntimeAction, GuiRuntimeActionRecord, GuiVerificationStatus } from '../gui/index.js'

export const GUI_BENCHMARK_TYPES = [
  'observe_health',
  'click_target',
  'type_text',
  'hotkey',
  'focus_switch',
  'visual_compare',
  'stuck_recovery',
  'approval_required',
  'release_input',
] as const

export type GuiBenchmarkType = typeof GUI_BENCHMARK_TYPES[number]
export type GuiBenchmarkMode = 'mock' | 'real_dingxu'
export type GuiBenchmarkStatus = 'passed' | 'failed' | 'skipped' | 'partial'
export type GuiBenchmarkRunStatus = 'passed' | 'failed' | 'partial'
export type GuiBenchmarkVerificationStatus = GuiVerificationStatus | 'skipped'
export type GuiBenchmarkRecoveryDecision = GuiRecoveryDecisionKind | 'not_applicable' | 'skipped_real_gui' | 'backend_missing' | 'probe_failed'

export type GuiBenchmarkManifest = {
  schemaVersion: 1
  name: string
  description?: string
  scenarios: GuiBenchmarkManifestEntry[]
}

export type GuiBenchmarkManifestEntry = {
  id: string
  title: string
  scenario: string
  mode?: GuiBenchmarkMode
  tags?: string[]
}

export type GuiBenchmarkScenarioExpectations = {
  status?: GuiBenchmarkStatus
  verificationStatus?: GuiBenchmarkVerificationStatus
  stuckDetected?: boolean
  inputReleased?: boolean
  approvalRequired?: boolean
  recoveryDecision?: GuiBenchmarkRecoveryDecision
  minEventCount?: number
  actionExecuted?: boolean
  failureReason?: string
}

export type GuiBenchmarkMockBehavior = {
  observationLatencyMs?: number
  actionLatencyMs?: number
  verificationLatencyMs?: number
  actionOk?: boolean
  actionMessage?: string
  verificationStatus?: GuiVerificationStatus
  verificationMessage?: string
  screenshotRefs?: string[]
}

export type GuiBenchmarkScenario = {
  schemaVersion: 1
  id: string
  title: string
  description: string
  type: GuiBenchmarkType
  mode: GuiBenchmarkMode
  action?: GuiRuntimeAction
  expectations?: GuiBenchmarkScenarioExpectations
  mock?: GuiBenchmarkMockBehavior
  tags?: string[]
}

export type GuiBenchmarkMetrics = {
  success: boolean
  durationMs: number
  observationLatencyMs: number
  actionLatencyMs: number
  verificationLatencyMs: number
  verificationStatus: GuiBenchmarkVerificationStatus
  stuckDetected: boolean
  inputReleased: boolean
  approvalRequired: boolean
  recoveryDecision?: GuiBenchmarkRecoveryDecision
  screenshotRefs: string[]
  eventIds: string[]
  failureReason?: string
}

export type GuiBenchmarkReplayRef = {
  kind: 'event' | 'checkpoint' | 'screenshot' | 'report'
  label: string
  ref: string
}

export type GuiBenchmarkEvidence = {
  actionExecuted?: boolean
  adapterActionCount?: number
  adapterReleaseCount?: number
  recordState?: GuiRuntimeActionRecord['state']
  guiActionId?: string
  checkpointId?: string
  dingxuProbeCode?: string
  dingxuDiagnostic?: string
}

export type GuiBenchmarkScenarioResult = {
  id: string
  title: string
  type: GuiBenchmarkType
  mode: GuiBenchmarkMode
  status: GuiBenchmarkStatus
  metrics: GuiBenchmarkMetrics
  replayRefs: GuiBenchmarkReplayRef[]
  evidence?: GuiBenchmarkEvidence
  scenarioPath?: string
}

export type GuiBenchmarkRunFiles = {
  jsonPath: string
  markdownPath: string
}

export type GuiBenchmarkRunResult = {
  runId: string
  manifestPath: string
  manifestName: string
  generatedAtMs: number
  status: GuiBenchmarkRunStatus
  scenarioCount: number
  passedCount: number
  failedCount: number
  skippedCount: number
  partialCount: number
  executedCount: number
  successRate: number
  results: GuiBenchmarkScenarioResult[]
  files?: GuiBenchmarkRunFiles
}

export type GuiDingxuProbeStatus = 'passed' | 'skipped' | 'partial' | 'failed'

export type GuiDingxuProbeResult = {
  status: GuiDingxuProbeStatus
  code: 'ok' | 'skipped_real_gui' | 'backend_missing' | 'probe_failed'
  durationMs: number
  message: string
  eventIds: string[]
  screenshotRefs: string[]
  diagnostic?: string
}
