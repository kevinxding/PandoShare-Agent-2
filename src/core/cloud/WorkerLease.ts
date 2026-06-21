import type { WorkerLease } from './CloudTypes.js'
export function createWorkerLease(workerId: string, jobId: string, nowMs = Date.now(), ttlMs = 30000): WorkerLease { return { leaseId: 'lease_' + nowMs.toString(36), workerId, jobId, leasedAtMs: nowMs, expiresAtMs: nowMs + ttlMs } }
