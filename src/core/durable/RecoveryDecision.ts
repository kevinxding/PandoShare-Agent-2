import type { EventEnvelope } from '../protocol/index.js'
import type { RunLedgerEntry } from './RunLedgerStore.js'
import type { KernelCheckpoint } from './CheckpointTypes.js'
import type { KernelHeartbeat } from './HeartbeatManager.js'
import type { RunSnapshot } from './RunSnapshotTypes.js'

export type RecoveryDecisionKind =
  | 'recoverable_auto'
  | 'requires_human'
  | 'mark_failed'
  | 'mark_corrupted'
  | 'already_completed'

export type RecoveryDecision = {
  decision: RecoveryDecisionKind
  reason: string
  runId: string
  recoverable: boolean
}

export type RecoveryPlannerInput = {
  runId: string
  latestRun?: RunLedgerEntry
  latestSnapshot?: RunSnapshot
  latestCheckpoint?: KernelCheckpoint
  events: readonly EventEnvelope[]
  latestHeartbeat?: KernelHeartbeat
  heartbeatAgeMs?: number
  heartbeatTtlMs: number
  corruptionErrors?: readonly string[]
}
