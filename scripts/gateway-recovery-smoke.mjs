#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { resolve, relative } from 'node:path'

const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gateway-recovery-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const daemon = new core.GatewayDaemon({ workspaceRoot: smokeRoot, workspaceId: 'default', source: 'test' })
  await daemon.durable.appendEvent({ eventType: 'run_failed', workspaceId: 'default', runId: 'run_gateway_requires_human', payload: { status: 'failed' } })
  await daemon.durable.appendRunLedger({ runId: 'run_gateway_requires_human', workspaceId: 'default', commandId: 'cmd_gateway_requires_human', commandType: 'agent.run', source: 'test', status: 'failed', createdAtMs: Date.now(), updatedAtMs: Date.now() })
  await daemon.durable.createCheckpoint({ workspaceId: 'default', runId: 'run_gateway_requires_human', status: 'safe_to_replay', summary: 'unsafe gateway outbound', effectHints: [{ source: 'gateway', action: 'outbound', summary: 'send external message' }] })
  await daemon.enqueueOutbound({ channelId: 'local', channelKind: 'local', userId: 'user', text: 'queued before recovery' })

  const recovered = new core.GatewayDaemon({ workspaceRoot: smokeRoot, workspaceId: 'default', source: 'test' })
  await recovered.recover()
  const sent = await recovered.sendNextOutbound()
  assert(sent?.status === 'delivered', 'queued outbound should remain sendable after recovery')
  const events = await recovered.durable.readEvents()
  assert(events.some(event => event.eventType === 'gateway_daemon_recovered'), 'recover should write gateway_daemon_recovered')
  assert(events.some(event => event.eventType === 'gateway_recovery_escalated'), 'requires_human recovery should write gateway_recovery_escalated')
  const recoveryOutbox = await recovered.store.readOutbound({ status: ['queued', 'delivered', 'retry_scheduled', 'failed'] })
  assert(recoveryOutbox.some(item => item.text.includes('Recovery requires human decision')), 'requires_human recovery should enqueue local approval message')

  let wakeCount = 0
  const loopCommandHandler = { async handle() { wakeCount += 1; return { ok: true, result: { wakeCount } } } }
  const wakeDaemon = new core.GatewayDaemon({ workspaceRoot: resolve(smokeRoot, 'wake'), workspaceId: 'default', source: 'test', dispatcher: { loopCommandHandler } })
  wakeDaemon.wakeScheduler.enroll('loop_gateway_wake_one')
  wakeDaemon.wakeScheduler.enroll('loop_gateway_wake_two')
  await wakeDaemon.tick({ maxInbound: 0, maxOutbound: 0 })
  assert(wakeCount === 1, `wake scheduler should run at most one loop task per tick, got ${wakeCount}`)
  const wakeEvents = await wakeDaemon.durable.readEvents()
  assert(wakeEvents.some(event => event.eventType === 'gateway_loop_wake_requested'), 'wake should write requested event')
  assert(wakeEvents.some(event => event.eventType === 'gateway_loop_wake_completed'), 'wake should write completed event')
  assert(wakeEvents.some(event => event.eventType === 'gateway_health_reported'), 'tick/status should report gateway health')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('gateway recovery smoke passed')

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
