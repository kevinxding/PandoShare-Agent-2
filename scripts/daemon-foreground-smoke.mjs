#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const daemon = await import('../dist/src/core/daemon/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-daemon-foreground-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const identity = { workspaceRoot: smokeRoot, workspaceId: 'default', runtimeId: 'daemon-smoke', workerType: 'test' }
  const processRunner = new daemon.DaemonProcess(identity)
  const output = await processRunner.runForeground({ command: 'daemon-foreground-smoke' })
  assert(output.status === 'stopped', `expected stopped foreground run, got ${output.status}`)

  const pidFile = new daemon.DaemonPidFile(identity)
  const pid = await pidFile.read()
  assert(pid?.status === 'stopped', `expected stopped pid record, got ${pid?.status}`)
  await readFile(pid.pidPath, 'utf8')

  const health = await new daemon.DaemonHealth(identity).report({ staleAfterMs: 1000 })
  assert(health.status === 'stopped', `expected stopped health, got ${health.status}`)
  assert(health.heartbeat?.status === 'stopped', `expected stopped heartbeat, got ${health.heartbeat?.status}`)

  const staleIdentity = { workspaceRoot: smokeRoot, workspaceId: 'default', runtimeId: 'daemon-stale', workerType: 'test' }
  const stalePidFile = new daemon.DaemonPidFile(staleIdentity)
  await stalePidFile.write({ pid: 999999999, status: 'running', command: 'stale-smoke' })
  const stale = await stalePidFile.inspect({ isProcessAlive: () => false })
  assert(stale.status === 'stale', `expected stale pid detection, got ${stale.status}`)
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('daemon foreground smoke passed')

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
