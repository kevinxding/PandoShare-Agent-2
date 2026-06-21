#!/usr/bin/env node
const core = await import('../../dist/src/core/index.js')
const envelope = core.createRemoteJobEnvelope({ workspaceId: 'default', taskType: 'agent', requiredCapabilities: ['agent'], nowMs: 10 })
assert(envelope.jobId && envelope.idempotencyKey, 'job envelope missing identity')
assert(envelope.permissionProfile === 'approval-required', 'default permission profile should require approval')
console.log('cloud job envelope smoke passed')
function assert(value, message) { if (!value) throw new Error(message) }
