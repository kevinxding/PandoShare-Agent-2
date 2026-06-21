#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const daemon = await import('../dist/src/core/daemon/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gateway-watchdog-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const identity = { workspaceRoot: smokeRoot, workspaceId: 'default', runtimeId: 'gateway-watchdog-smoke', workerType: 'gateway' }
  const pidFile = new daemon.DaemonPidFile(identity)
  const pid = await pidFile.write({ pid: process.pid, status: 'running', command: 'gateway-watchdog-smoke' })
  const health = new daemon.DaemonHealth(identity)
  await health.durable.writeHeartbeat({
    workspaceId: 'default',
    workerId: 'gateway-watchdog-smoke',
    runtimeId: 'gateway-watchdog-smoke',
    workerType: 'gateway',
    kernel: 'gateway',
    pid: pid.pid,
    status: 'running',
    lastHeartbeatAtMs: Date.now() - 60_000,
    message: 'old heartbeat',
  })

  const watchdog = new daemon.Watchdog(identity)
  const report = await watchdog.check({ staleAfterMs: 1 })
  assert(report.status === 'stale', `expected stale watchdog report, got ${report.status}`)
  assert(report.markedStale === true, 'watchdog should mark stale heartbeat')

  const latest = await health.durable.readHeartbeat('gateway-watchdog-smoke')
  assert(latest?.status === 'stale', `expected latest heartbeat status stale, got ${latest?.status}`)
  const crash = await new daemon.DaemonCommand(identity).readCrashMarker()
  assert(crash?.reason === 'stale_heartbeat', `expected stale_heartbeat crash marker, got ${crash?.reason}`)
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('gateway watchdog smoke passed')

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
