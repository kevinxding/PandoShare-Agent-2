#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const service = await import('../dist/src/core/gateway-daemon-service/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gateway-webhook-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const runtime = new service.GatewayServiceRuntime({
    workspaceRoot: smokeRoot,
    workspaceId: 'default',
    runtimeId: 'gateway-webhook-smoke',
  })
  const server = new service.GatewayWebhookServer({
    runtime,
    ingressSecret: 'smoke-secret',
    host: '127.0.0.1',
    port: 0,
  })
  const handle = await server.start()
  try {
    const unauthorized = await fetch(`${handle.url}/gateway/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'mock-user', text: 'blocked' }),
    })
    assert(unauthorized.status === 401, `expected unauthorized request to be rejected, got ${unauthorized.status}`)

    const nonMock = await fetch(`${handle.url}/gateway/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pando-gateway-secret': 'smoke-secret' },
      body: JSON.stringify({ channelId: 'telegram', channelKind: 'telegram', userId: 'mock-user', text: 'blocked' }),
    })
    assert(nonMock.status === 400, `expected non-mock channel to be rejected, got ${nonMock.status}`)

    const accepted = await fetch(`${handle.url}/gateway/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pando-gateway-secret': 'smoke-secret' },
      body: JSON.stringify({ userId: 'mock-user', text: '/health', externalMessageId: 'webhook-smoke-1' }),
    })
    const body = await accepted.json()
    assert(accepted.status === 202 && body.ok === true, `expected accepted webhook, got ${accepted.status}`)

    const pending = await runtime.gateway.store.readInbound({ status: 'pending' })
    assert(pending.some(item => item.externalMessageId === 'webhook-smoke-1'), 'webhook should queue mock inbound message')
  } finally {
    await handle.close()
  }
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('gateway webhook smoke passed')

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
