import { createProtocolId } from '../protocol/index.js'
import { JsonlStore, type JsonlReadResult, ProcessFileLock } from '../store/index.js'
import type { RunSnapshot, WriteRunSnapshotInput } from './RunSnapshotTypes.js'

export class RunSnapshotStore {
  private readonly lock: ProcessFileLock

  constructor(private readonly store: JsonlStore<RunSnapshot>) {
    this.lock = new ProcessFileLock(store.path)
  }

  async writeSnapshot(input: WriteRunSnapshotInput): Promise<RunSnapshot> {
    assertJsonSerializable(input)
    const snapshot: RunSnapshot = {
      snapshotId: input.snapshotId ?? createProtocolId('snapshot'),
      workspaceId: input.workspaceId,
      runId: input.runId,
      threadId: input.threadId,
      status: input.status,
      lastEventSeq: input.lastEventSeq,
      activePhase: input.activePhase,
      activeToolCallId: input.activeToolCallId,
      activeApprovalId: input.activeApprovalId,
      activeModelRequestId: input.activeModelRequestId,
      loopTaskId: input.loopTaskId,
      guiActionId: input.guiActionId,
      gatewayDeliveryId: input.gatewayDeliveryId,
      retryCount: input.retryCount ?? 0,
      createdAtMs: input.createdAtMs ?? Date.now(),
    }
    await this.store.appendLocked(snapshot, this.lock, { reason: 'run snapshot append' })
    return snapshot
  }

  async readSnapshots(runId: string): Promise<RunSnapshot[]> {
    return (await this.store.readRecords())
      .filter(snapshot => snapshot.runId === runId)
      .sort((left, right) => left.lastEventSeq - right.lastEventSeq || left.createdAtMs - right.createdAtMs)
  }

  async readLatestSnapshot(runId: string): Promise<RunSnapshot | undefined> {
    return (await this.readSnapshots(runId)).sort((left, right) => {
      if (right.lastEventSeq !== left.lastEventSeq) return right.lastEventSeq - left.lastEventSeq
      return right.createdAtMs - left.createdAtMs
    })[0]
  }

  async readWithCorruption(): Promise<JsonlReadResult<RunSnapshot>> {
    return this.store.readWithCorruption()
  }
}

function assertJsonSerializable(value: unknown): void {
  JSON.stringify(value)
}
