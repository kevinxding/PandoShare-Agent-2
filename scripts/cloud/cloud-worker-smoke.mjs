#!/usr/bin/env node
const core = await import('../../dist/src/core/index.js')
const coordinator = new core.CloudCoordinator({ workspaceRoot: process.cwd() })
coordinator.registerWorker({ workerId: 'local-1', kind: 'local', capabilities: ['agent'], status: 'idle', lastHeartbeatAtMs: 1 })
coordinator.registerWorker({ workerId: 'remote-1', kind: 'remote_placeholder', capabilities: ['agent'], status: 'idle', lastHeartbeatAtMs: 1 })
assert(coordinator.registry.list().find(w => w.workerId === 'remote-1').status === 'disabled', 'remote placeholder must be disabled')
console.log('cloud worker smoke passed')
function assert(value, message) { if (!value) throw new Error(message) }
