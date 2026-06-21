#!/usr/bin/env node
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
const core = await import('../../dist/src/core/index.js')
const tmp = resolve(process.cwd(), '.tmp-cloud-coordinator-smoke')
await rm(tmp, { recursive: true, force: true })
const coordinator = new core.CloudCoordinator({ workspaceRoot: tmp, now: () => 100 })
coordinator.registerWorker({ workerId: 'mock-1', kind: 'mock', capabilities: ['agent','loop'], status: 'idle', lastHeartbeatAtMs: 100 })
const job = await coordinator.submitJob(core.createRemoteJobEnvelope({ workspaceId: 'default', taskType: 'loop', requiredCapabilities: ['loop'], nowMs: 100 }))
const lease = await coordinator.leaseJob('mock-1')
assert(lease && lease.jobId === job.envelope.jobId, 'lease should claim queued job')
const secondLease = await coordinator.leaseJob('mock-1')
assert(secondLease === undefined, 'lease should prevent duplicate claim')
const done = await coordinator.completeJob(job.envelope.jobId)
assert(done.status === 'completed', 'job should complete')
await rm(tmp, { recursive: true, force: true })
console.log('cloud coordinator smoke passed')
function assert(value, message) { if (!value) throw new Error(message) }
