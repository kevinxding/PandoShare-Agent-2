import type { WorkerRecord } from './CloudTypes.js'
export class WorkerRegistry {
  private readonly workers = new Map<string, WorkerRecord>()
  register(worker: WorkerRecord): WorkerRecord { if (worker.kind === 'remote_placeholder') worker = { ...worker, status: 'disabled' }; this.workers.set(worker.workerId, worker); return worker }
  heartbeat(workerId: string, nowMs = Date.now()): WorkerRecord { const worker = this.require(workerId); const next = { ...worker, lastHeartbeatAtMs: nowMs, status: worker.kind === 'remote_placeholder' ? 'disabled' as const : worker.status }; this.workers.set(workerId, next); return next }
  list(): WorkerRecord[] { return [...this.workers.values()] }
  findAvailable(capabilities: readonly string[]): WorkerRecord | undefined { return this.list().find(worker => worker.status === 'idle' && worker.kind !== 'remote_placeholder' && capabilities.every(capability => worker.capabilities.includes(capability))) }
  update(worker: WorkerRecord): void { this.workers.set(worker.workerId, worker) }
  require(workerId: string): WorkerRecord { const worker = this.workers.get(workerId); if (!worker) throw new Error('Unknown worker: ' + workerId); return worker }
}
