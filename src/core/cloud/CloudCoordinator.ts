import { appendFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createWorkerLease } from './WorkerLease.js'
import { WorkerRegistry } from './WorkerRegistry.js'
import type { CloudJobRecord, RemoteJobEnvelope, WorkerLease, WorkerRecord } from './CloudTypes.js'

export class CloudCoordinator {
  readonly registry = new WorkerRegistry()
  private readonly jobs = new Map<string, CloudJobRecord>()

  constructor(private readonly options: { workspaceRoot: string; jsonlPath?: string; now?: () => number }) {}

  registerWorker(worker: WorkerRecord): WorkerRecord { return this.registry.register(worker) }

  async submitJob(envelope: RemoteJobEnvelope): Promise<CloudJobRecord> {
    assertNoSecret(envelope)
    const record = { envelope, status: 'queued' as const }
    this.jobs.set(envelope.jobId, record)
    await this.append(record)
    return record
  }

  async leaseJob(workerId: string): Promise<WorkerLease | undefined> {
    const worker = this.registry.require(workerId)
    if (worker.kind === 'remote_placeholder' || worker.status === 'disabled') return undefined
    const job = [...this.jobs.values()].find(item => item.status === 'queued' && item.envelope.requiredCapabilities.every(cap => worker.capabilities.includes(cap)))
    if (!job) return undefined
    const now = this.now()
    const lease = createWorkerLease(worker.workerId, job.envelope.jobId, now)
    const nextJob = { ...job, status: 'leased' as const, lease }
    this.jobs.set(job.envelope.jobId, nextJob)
    this.registry.update({ ...worker, status: 'leased', activeJobId: job.envelope.jobId, lastHeartbeatAtMs: now })
    await this.append(nextJob)
    return lease
  }

  async completeJob(jobId: string, message = 'completed'): Promise<CloudJobRecord> {
    const job = this.requireJob(jobId)
    const next = { ...job, status: 'completed' as const, completedAtMs: this.now(), message }
    this.jobs.set(jobId, next)
    this.releaseWorker(job)
    await this.append(next)
    return next
  }

  async failJob(jobId: string, message: string): Promise<CloudJobRecord> {
    const job = this.requireJob(jobId)
    const next = { ...job, status: 'failed' as const, failedAtMs: this.now(), message }
    this.jobs.set(jobId, next)
    this.releaseWorker(job)
    await this.append(next)
    return next
  }

  heartbeat(workerId: string): WorkerRecord { return this.registry.heartbeat(workerId, this.now()) }
  listJobs(): CloudJobRecord[] { return [...this.jobs.values()] }

  private async append(record: CloudJobRecord): Promise<void> {
    const file = resolve(this.options.workspaceRoot, this.options.jsonlPath ?? '.pandoshare/cloud/jobs.jsonl')
    await mkdir(resolve(file, '..'), { recursive: true })
    await appendFile(file, JSON.stringify(record) + '\n', 'utf8')
  }

  private requireJob(jobId: string): CloudJobRecord {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('Unknown cloud job: ' + jobId)
    return job
  }

  private releaseWorker(job: CloudJobRecord): void {
    if (!job.lease) return
    const worker = this.registry.require(job.lease.workerId)
    this.registry.update({ ...worker, status: 'idle', activeJobId: undefined })
  }

  private now(): number { return this.options.now?.() ?? Date.now() }
}

function assertNoSecret(value: unknown): void {
  if (/token|secret|api[-_]?key|authorization|password/i.test(JSON.stringify(value))) throw new Error('Cloud job envelope must not include secret-bearing fields')
}
