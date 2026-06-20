export type CheckpointStatus = 'safe_to_replay' | 'unsafe_to_replay' | 'partial_replay'

export type PendingExternalEffect = {
  effectId: string
  effectType: 'shell' | 'gui_action' | 'gateway_outbound' | 'file_write' | 'mcp_write' | 'other' | string
  summary: string
  confirmed: boolean
}

export type KernelCheckpoint = {
  checkpointId: string
  workspaceId: string
  runId?: string
  threadId?: string
  goalId?: string
  loopId?: string
  commandId?: string
  status: CheckpointStatus
  reason?: string
  lastEventSeq: number
  createdAtMs: number
  summary: string
  snapshotRef?: string
  unsafeToReplayToolCallIds: string[]
  pendingExternalEffects: PendingExternalEffect[]
  payload?: unknown
}

export type CreateCheckpointInput = Omit<
  KernelCheckpoint,
  'checkpointId' | 'createdAtMs' | 'status' | 'summary' | 'lastEventSeq' | 'unsafeToReplayToolCallIds' | 'pendingExternalEffects'
> & {
  checkpointId?: string
  createdAtMs?: number
  status?: KernelCheckpoint['status']
  summary?: string
  lastEventSeq?: number
  unsafeToReplayToolCallIds?: string[]
  pendingExternalEffects?: PendingExternalEffect[]
  effectHints?: import('./SideEffectTypes.js').SideEffectHint[]
}

export function validateCheckpoint(checkpoint: KernelCheckpoint, latestEventSeq: number): void {
  if (checkpoint.lastEventSeq > latestEventSeq) {
    throw new Error(`Checkpoint ${checkpoint.checkpointId} references future event seq ${checkpoint.lastEventSeq}`)
  }
  const payloadText = checkpoint.payload === undefined ? '' : JSON.stringify(checkpoint.payload)
  if (payloadText.length > 200_000) {
    throw new Error(`Checkpoint ${checkpoint.checkpointId} payload is too large; use snapshotRef or summary`)
  }
}
