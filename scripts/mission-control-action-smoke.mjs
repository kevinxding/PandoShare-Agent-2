#!/usr/bin/env node
const core = await import('../dist/src/core/index.js')
const service = new core.MissionControlService({ workspaceRoot: process.cwd(), now: () => 2000 })
const health = await service.runAction({ action: 'system.health', payload: { token: 'sk-testsecret1234567890' } })
assert(health.ok === true, 'system.health wrapper must be ok')
assert(health.data.backendAction === 'system.health', 'system.health must map to BackendService')
assert(health.data.backend.requestId, 'backend response must include requestId')
assert(!JSON.stringify(health).includes('sk-testsecret1234567890'), 'action response must redact secret payload')
const loop = await service.runAction({ action: 'loop.runNext', payload: { loopId: 'mission_mock_loop' } })
assert(loop.ok === true, 'loop.runNext wrapper must be ok')
assert(loop.data.backendAction === 'loop.runNext', 'loop.runNext must map to BackendService')
console.log('mission control action smoke passed')
function assert(value, message) { if (!value) throw new Error(message) }
