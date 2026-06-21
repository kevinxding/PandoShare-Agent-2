import { DurableRuntime, type KernelHeartbeat } from '../durable/index.js'
import { DaemonPidFile } from './DaemonPidFile.js'
import type { DaemonHealthReport, DaemonHeartbeatSnapshot, DaemonHeartbeatStatus, DaemonRuntimeIdentity } from './DaemonTypes.js'

export type DaemonHealthInput = DaemonRuntimeIdentity & {
  workerType?: 'agent' | 'loop' | 'gateway' | 'gui' | 'model' | 'test'
}

export class DaemonHealth {
  readonly durable: DurableRuntime
  readonly pidFile: DaemonPidFile
  private readonly workerType: 'agent' | 'loop' | 'gateway' | 'gui' | 'model' | 'test'

  constructor(private readonly input: DaemonHealthInput) {
    this.pidFile = new DaemonPidFile(input)
    this.durable = new DurableRuntime({ workspaceRoot: input.workspaceRoot, workspaceId: this.pidFile.paths.workspaceId })
    this.workerType = input.workerType ?? 'gateway'
  }

  async writeHeartbeat(input: { status: DaemonHeartbeatStatus; message?: string; metadata?: unknown; pid?: number } = { status: 'running' }): Promise<KernelHeartbeat> {
    const pidRecord = await this.pidFile.read()
    return this.durable.writeHeartbeat({
      workspaceId: this.pidFile.paths.workspaceId,
      workerId: this.pidFile.paths.runtimeId,
      runtimeId: this.pidFile.paths.runtimeId,
      workerType: this.workerType,
      kernel: this.workerType,
      pid: input.pid ?? pidRecord?.pid,
      status: input.status,
      message: input.message,
      metadata: input.metadata,
    })
  }

  async readHeartbeat(): Promise<DaemonHeartbeatSnapshot | undefined> {
    const heartbeat = await this.durable.readHeartbeat(this.pidFile.paths.runtimeId)
    if (!heartbeat) return undefined
    return {
      workerId: heartbeat.workerId,
      status: heartbeat.status,
      lastHeartbeatAtMs: heartbeat.lastHeartbeatAtMs,
      pid: heartbeat.pid,
      message: heartbeat.message,
    }
  }

  async report(input: { staleAfterMs?: number; nowMs?: number } = {}): Promise<DaemonHealthReport> {
    const staleAfterMs = Math.max(1, input.staleAfterMs ?? 30_000)
    const nowMs = input.nowMs ?? Date.now()
    const [pid, heartbeat] = await Promise.all([
      this.pidFile.inspect(),
      this.readHeartbeat(),
    ])

    if (pid.status === 'missing' && !heartbeat) {
      return {
        ok: true,
        status: 'not_started',
        stale: false,
        staleAfterMs,
        pid,
        message: 'Daemon has not been started.',
      }
    }

    const heartbeatAgeMs = heartbeat ? Math.max(0, nowMs - heartbeat.lastHeartbeatAtMs) : undefined
    if (heartbeat?.status === 'stopped') {
      return {
        ok: true,
        status: 'stopped',
        stale: false,
        staleAfterMs,
        heartbeatAgeMs,
        pid,
        heartbeat,
        message: heartbeat.message ?? 'Daemon is stopped.',
      }
    }

    if (heartbeat?.status === 'failed') {
      return {
        ok: false,
        status: 'failed',
        stale: true,
        staleAfterMs,
        heartbeatAgeMs,
        pid,
        heartbeat,
        message: heartbeat.message ?? 'Daemon heartbeat is failed.',
      }
    }

    if (heartbeat?.status === 'stale') {
      return {
        ok: false,
        status: 'stale',
        stale: true,
        staleAfterMs,
        heartbeatAgeMs,
        pid,
        heartbeat,
        message: heartbeat.message ?? 'Daemon heartbeat is marked stale.',
      }
    }

    if (heartbeatAgeMs !== undefined && heartbeatAgeMs > staleAfterMs) {
      return {
        ok: false,
        status: 'stale',
        stale: true,
        staleAfterMs,
        heartbeatAgeMs,
        pid,
        heartbeat,
        message: `Daemon heartbeat is stale: age=${heartbeatAgeMs}ms, threshold=${staleAfterMs}ms.`,
      }
    }

    if (pid.stale && pid.record?.status !== 'stopped') {
      return {
        ok: false,
        status: 'stale',
        stale: true,
        staleAfterMs,
        heartbeatAgeMs,
        pid,
        heartbeat,
        message: pid.message,
      }
    }

    if (!heartbeat) {
      return {
        ok: false,
        status: 'unknown',
        stale: true,
        staleAfterMs,
        pid,
        message: 'Daemon PID exists but heartbeat is missing.',
      }
    }

    return {
      ok: true,
      status: 'healthy',
      stale: false,
      staleAfterMs,
      heartbeatAgeMs,
      pid,
      heartbeat,
      message: `Daemon heartbeat is fresh: age=${heartbeatAgeMs ?? 0}ms, threshold=${staleAfterMs}ms.`,
    }
  }
}
