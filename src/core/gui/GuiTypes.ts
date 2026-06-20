import type { PendingExternalEffect } from '../durable/index.js'
import type { GuiActionIdentity } from './GuiIdentity.js'
import type { GuiActionState } from './GuiActionState.js'

export type GuiActionPoint = { x: number; y: number }
export type GuiActionRegion = { left: number; top: number; right?: number; bottom?: number; width?: number; height?: number }

export type GuiVerificationSpec = {
  type?: 'screenshot' | 'visual_change' | 'custom'
  expectedChange?: 'changed' | 'unchanged' | 'unknown'
  timeoutMs?: number
  summary?: string
}

export type GuiApprovalPolicy = 'never' | 'ask' | 'trusted'

export type GuiRuntimeAction = {
  action: string
  target?: string
  text?: string
  keys?: readonly string[]
  x?: number
  y?: number
  points?: readonly GuiActionPoint[]
  strokes?: readonly (readonly GuiActionPoint[])[]
  region?: GuiActionRegion
  timeoutMs?: number
  verify?: boolean | string | GuiVerificationSpec
  riskHint?: string
  approvalPolicy?: GuiApprovalPolicy
  expectedChange?: 'changed' | 'unchanged' | 'unknown' | 'required' | 'optional' | 'none'
  idempotencyKey?: string
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type GuiObservationSource = 'dingxu' | 'mock' | 'legacy'

export type GuiObservation = {
  observationId: string
  createdAtMs: number
  screenshotRef?: string
  accessibilityTreeRef?: string
  focusedApp?: string
  focusedElement?: string
  summary: string
  hash?: string
  source: GuiObservationSource
  confidence?: number
}

export type GuiVerificationStatus = 'passed' | 'failed' | 'inconclusive'

export type GuiVerification = {
  ok: boolean
  status: GuiVerificationStatus
  message: string
  screenshotRef?: string
  beforeObservationId?: string
  afterObservationId?: string
  diffRef?: string
  visualChange?: 'changed' | 'unchanged' | 'unknown'
  confidence?: number
  reasonCode?: string
}

export type GuiActionRiskLevel = 'read_only' | 'low_write' | 'write' | 'dangerous_write'

export type GuiActionRisk = {
  level: GuiActionRiskLevel
  reason: string
  action: string
}

export type GuiApprovalRecord = {
  required: boolean
  status: 'not_required' | 'waiting' | 'approved' | 'rejected'
  policy: GuiApprovalPolicy
  reason?: string
  approvedByPolicy?: boolean
  decidedAtMs?: number
}

export type GuiLease = {
  leaseId: string
  guiActionId: string
  workspaceId: string
  acquiredAtMs: number
  expiresAtMs: number
  holder: string
  status: 'running' | 'released' | 'expired'
}

export type GuiRuntimeActionRecord = {
  actionId?: string
  eventId?: string
  screenshotRef?: string
  identity: GuiActionIdentity
  state: GuiActionState
  beforeObservation?: GuiObservation
  afterObservation?: GuiObservation
  action: GuiRuntimeAction
  approval?: GuiApprovalRecord
  result?: GuiAdapterResult
  verification?: GuiVerification
  lease?: GuiLease
  sideEffect: PendingExternalEffect
  checkpointId?: string
  eventIds: string[]
  createdAtMs: number
  completedAtMs?: number
  warnings?: string[]
}

export type GuiAdapterResult = {
  ok: boolean
  message: string
  method?: 'uia' | 'visual' | 'human_gui' | 'mock' | 'none' | string
  screenshotRef?: string
  screenshotPath?: string
  fallbackUsed?: boolean
  failureClass?: string
  audit?: Record<string, unknown>
}

export type GuiAdapter = {
  observe(context?: GuiRuntimeContext): Promise<GuiObservation>
  act(action: GuiRuntimeAction, context?: GuiRuntimeContext): Promise<GuiAdapterResult>
  verify(action: GuiRuntimeAction, context?: GuiRuntimeContext): Promise<GuiVerification>
}

export type GuiRuntimeContext = {
  guiActionId?: string
  runId?: string
  loopId?: string
  goalId?: string
  taskId?: string
  attemptId?: string
  source?: GuiActionIdentity['source']
  holder?: string
}

export type GuiRecoveryDecisionKind = 'already_completed' | 'requires_human' | 'recoverable_readonly' | 'mark_failed'

export type GuiRecoveryDecision = {
  decision: GuiRecoveryDecisionKind
  reason: string
  guiActionId: string
  state?: GuiActionState
}
