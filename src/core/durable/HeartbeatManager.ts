import { createProtocolId } from '../protocol/index.js'
import { JsonlStore, type JsonlReadResult, ProcessFileLock } from '../store/index.js'
import { redactDurablePayload } from './DurableRedaction.js'

export type KernelHeartbeat = {
  heartbeatId: string
  workspaceId: string
  workerId: string
  workerType: 'agent' | 'loop' | 'gateway' | 'gui' | 'model' | 'test'
  runId?: string
  loopId?: string
  gatewayId?: string
  pid?: number
  status: 'starting' | 'running' | 'idle' | 'stopping' | 'stopped' | 'stale' | 'failed'
  lastSeq?: number
  lastHeartbeatAtMs: number
  metadata?: unknown
  runtimeId: string
  kernel: string
  message?: string
  payload?: unknown
}

export type WriteHeartbeatInput = Omit<
  KernelHeartbeat,
  'heartbeatId' | 'lastHeartbeatAtMs' | 'workerId' | 'workerType' | 'runtimeId' | 'kernel'
> & {
  heartbeatId?: string
  lastHeartbeatAtMs?: number
  workerId?: string
  workerType?: KernelHeartbeat['workerType']
  runtimeId?: string
  kernel?: string
  createdAtMs?: number
}

export class HeartbeatManager {
  private readonly lock: ProcessFileLock

  constructor(private readonly store: JsonlStore<KernelHeartbeat>) {
    this.lock = new ProcessFileLock(store.path)
  }

  async writeHeartbeat(input: WriteHeartbeatInput): Promise<KernelHeartbeat> {
    const workerId = input.workerId ?? input.runtimeId
    if (!workerId) throw new Error('Heartbeat requires workerId')
    const workerType = input.workerType ?? workerTypeFromLegacyKernel(input.kernel)
    const heartbeatAt = input.lastHeartbeatAtMs ?? input.createdAtMs ?? Date.now()
    const heartbeat: KernelHeartbeat = {
      heartbeatId: input.heartbeatId ?? createProtocolId('heartbeat'),
      workspaceId: input.workspaceId,
      workerId,
      workerType,
      runId: input.runId,
      loopId: input.loopId,
      gatewayId: input.gatewayId,
      pid: input.pid,
      status: input.status,
      lastSeq: input.lastSeq,
      lastHeartbeatAtMs: heartbeatAt,
      metadata: redactDurablePayload(input.metadata),
      runtimeId: workerId,
      kernel: input.kernel ?? workerType,
      message: input.message,
      payload: redactDurablePayload(input.payload),
    }
    await this.store.appendLocked(heartbeat, this.lock, { reason: 'heartbeat append' })
    return heartbeat
  }

  async readHeartbeat(workerId: string): Promise<KernelHeartbeat | undefined> {
    return (await this.listHeartbeats({ workerId })).sort((left, right) => right.lastHeartbeatAtMs - left.lastHeartbeatAtMs)[0]
  }

  async readRunHeartbeat(runId: string): Promise<KernelHeartbeat | undefined> {
    return (await this.listHeartbeats({ runId })).sort((left, right) => right.lastHeartbeatAtMs - left.lastHeartbeatAtMs)[0]
  }

  async listHeartbeats(input: { workerId?: string; runtimeId?: string; workerType?: string; kernel?: string; runId?: string } = {}): Promise<KernelHeartbeat[]> {
    return (await this.store.readRecords())
      .filter(record => input.workerId === undefined || record.workerId === input.workerId)
      .filter(record => input.runtimeId === undefined || record.runtimeId === input.runtimeId)
      .filter(record => input.workerType === undefined || record.workerType === input.workerType)
      .filter(record => input.kernel === undefined || record.kernel === input.kernel)
      .filter(record => input.runId === undefined || record.runId === input.runId)
  }

  async readWithCorruption(): Promise<JsonlReadResult<KernelHeartbeat>> {
    return this.store.readWithCorruption()
  }

  async isStale(workerId: string, nowMs: number, ttlMs: number): Promise<boolean> {
    const heartbeat = await this.readHeartbeat(workerId)
    if (!heartbeat) return true
    return nowMs - heartbeat.lastHeartbeatAtMs > ttlMs
  }
}

function workerTypeFromLegacyKernel(kernel?: string): KernelHeartbeat['workerType'] {
  if (kernel === 'agent' || kernel === 'loop' || kernel === 'gateway' || kernel === 'gui' || kernel === 'model' || kernel === 'test') {
    return kernel
  }
  return 'test'
}
