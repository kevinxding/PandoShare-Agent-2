#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { resolve, relative } from 'node:path'

const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gateway-delivery-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const success = new core.GatewayDaemon({ workspaceRoot: resolve(smokeRoot, 'success'), source: 'test' })
  await success.enqueueOutbound({ channelId: 'local', channelKind: 'local', userId: 'user', text: 'deliver once' })
  const delivered = await success.sendNextOutbound()
  assert(delivered?.status === 'delivered', `expected delivered, got ${delivered?.status}`)

  const temporary = new core.GatewayDaemon({ workspaceRoot: resolve(smokeRoot, 'temporary'), source: 'test', adapterConfigs: { local: { failMode: 'temporary' } } })
  const queued = await temporary.enqueueOutbound({ channelId: 'local', channelKind: 'local', userId: 'user', text: 'retry me' })
  const retried = await temporary.sendNextOutbound()
  assert(retried?.status === 'retry_scheduled', `expected retry_scheduled, got ${retried?.status}`)
  assert(retried.deliveryId === queued.deliveryId, 'retry should keep the same deliveryId')

  const permanent = new core.GatewayDaemon({ workspaceRoot: resolve(smokeRoot, 'permanent'), source: 'test', adapterConfigs: { local: { failMode: 'permanent' } } })
  await permanent.enqueueOutbound({ channelId: 'local', channelKind: 'local', userId: 'user', text: 'fail forever' })
  const failed = await permanent.sendNextOutbound()
  assert(failed?.status === 'failed', `expected failed, got ${failed?.status}`)

  const missing = new core.GatewayDaemon({ workspaceRoot: resolve(smokeRoot, 'missing'), source: 'test' })
  await missing.enqueueOutbound({ channelId: 'telegram', channelKind: 'telegram', userId: 'user', text: 'missing config' })
  const missingResult = await missing.sendNextOutbound()
  assert(missingResult?.status === 'failed', 'missing_config should fail without crashing')
  assert(missingResult?.lastError?.includes('missing'), 'missing_config should report a missing config error')

  const durableRoot = resolve(smokeRoot, 'survive')
  const beforeRestart = new core.GatewayDaemon({ workspaceRoot: durableRoot, source: 'test' })
  const persistent = await beforeRestart.enqueueOutbound({ channelId: 'local', channelKind: 'local', userId: 'user', text: 'survive restart' })
  const afterRestart = new core.GatewayDaemon({ workspaceRoot: durableRoot, source: 'test' })
  const after = await afterRestart.sendNextOutbound()
  assert(after?.deliveryId === persistent.deliveryId, 'outbound queue should survive daemon instance restart')
  assert(after?.status === 'delivered', 'restarted daemon should deliver queued outbound')

  const events = await afterRestart.durable.readEvents()
  assert(events.some(event => event.eventType === 'gateway_outbound_queued'), 'outbound queued event should be written')
  assert(events.some(event => event.eventType === 'gateway_outbound_delivered'), 'outbound delivered event should be written')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('gateway delivery smoke passed')

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
