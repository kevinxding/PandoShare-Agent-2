import type { CloudJobRecord, RemoteJobEnvelope, WorkerLease, WorkerRecord } from './CloudTypes.js'
export type CloudWorkerProtocol = {
  registerWorker(worker: WorkerRecord): WorkerRecord
  submitJob(job: RemoteJobEnvelope): Promise<CloudJobRecord>
  leaseJob(workerId: string): Promise<WorkerLease | undefined>
  completeJob(jobId: string, message?: string): Promise<CloudJobRecord>
  failJob(jobId: string, message: string): Promise<CloudJobRecord>
  heartbeat(workerId: string): WorkerRecord
}
