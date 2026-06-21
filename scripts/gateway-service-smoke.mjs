#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const service = await import('../dist/src/core/gateway-daemon-service/index.js')
const gateway = await import('../dist/src/core/gateway/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gateway-service-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

class FlakyMockAdapter extends gateway.MockGatewayChannelAdapter {
  attempts = 0

  async send(outbound) {
    if (outbound.text === 'retry me') {
      this.attempts += 1
      if (this.attempts === 1) {
        return { ok: false, status: 'failed', failureClass: 'temporary', retryAfterMs: 0, message: 'temporary smoke failure' }
      }
    }
    return { ok: true, status: 'delivered', externalMessageId: `mock-${outbound.deliveryId}` }
  }
}

try {
  const adapter = new FlakyMockAdapter('mock')
  const runtime = new service.GatewayServiceRuntime({
    workspaceRoot: smokeRoot,
    workspaceId: 'default',
    runtimeId: 'gateway-service-smoke',
    adapters: [adapter],
    intervalMs: 0,
    maxTicks: 3,
  })
  await runtime.gateway.receiveInbound({
    channelId: 'mock',
    channelKind: 'mock',
    userId: 'mock-user',
    text: '/health',
    externalMessageId: 'gateway-service-inbound-1',
  })
  const retry = await runtime.gateway.enqueueOutbound({
    channelId: 'mock',
    channelKind: 'mock',
    userId: 'mock-user',
    text: 'retry me',
  })

  const output = await runtime.run({ maxTicks: 3, intervalMs: 0 })
  assert(output.ticks.length === 3, `expected exactly 3 service ticks, got ${output.ticks.length}`)
  assert(output.health.daemon.status === 'stopped', `expected stopped daemon health, got ${output.health.daemon.status}`)

  const routed = await runtime.gateway.store.readInbound({ status: 'routed' })
  assert(routed.some(item => item.externalMessageId === 'gateway-service-inbound-1'), 'service tick should route queued inbound')

  const [delivery] = await runtime.gateway.store.readOutbound({ deliveryId: retry.deliveryId })
  assert(delivery?.status === 'delivered', `expected retried outbound to deliver, got ${delivery?.status}`)
  assert(delivery?.attempt === 2, `expected retry attempt count 2, got ${delivery?.attempt}`)
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('gateway service smoke passed')

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
