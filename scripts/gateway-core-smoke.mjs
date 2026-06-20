#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { resolve, relative } from 'node:path'

const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gateway-core-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const agentKernel = {
    async submitRun(command) {
      assert(command.commandType === 'agent.run', 'default text should dispatch to agent.run')
      return { runId: 'run_gateway_core', threadId: 'thread_gateway_core', finalText: 'core agent reply', output: { finalText: 'core agent reply', toolResults: [] }, coreEvents: [] }
    },
  }
  const daemon = new core.GatewayDaemon({ workspaceRoot: smokeRoot, workspaceId: 'default', source: 'test', dispatcher: { agentKernel } })
  await daemon.start()
  await daemon.receiveInbound({ channelId: 'local', userId: 'local-user', text: 'hello gateway', externalMessageId: 'external-core-1', createdAtMs: 1000 })
  await daemon.receiveInbound({ channelId: 'local', userId: 'local-user', text: 'hello gateway', externalMessageId: 'external-core-1', createdAtMs: 1000 })
  assert((await daemon.store.readInbound()).length === 1, 'duplicate inbound should not append a second inbound')
  const dispatched = await daemon.dispatchNextInbound()
  assert(dispatched?.commandType === 'agent.run', `expected agent.run, got ${dispatched?.commandType}`)
  assert(dispatched.runId === 'run_gateway_core', 'dispatch reply should include run id from AgentKernel')
  await daemon.sendNextOutbound()
  const status = await daemon.status()
  assert(status.inboundCount === 1, 'status should come from GatewayStore projection')
  await daemon.stop()
  const events = await daemon.durable.readEvents()
  assert(events.some(event => event.eventType === 'gateway_daemon_started'), 'start should write gateway_daemon_started')
  assert(events.some(event => event.eventType === 'gateway_heartbeat'), 'start/tick should write gateway_heartbeat')
  assert(events.some(event => event.eventType === 'gateway_inbound_received'), 'receiveInbound should write gateway_inbound_received')
  assert(events.some(event => event.eventType === 'gateway_inbound_deduped'), 'duplicate inbound should write gateway_inbound_deduped')
  assert(events.some(event => event.eventType === 'gateway_command_created'), 'dispatch should write gateway_command_created')
  assert(events.some(event => event.eventType === 'gateway_command_dispatched'), 'dispatch should write gateway_command_dispatched')
  assert(events.some(event => event.eventType === 'gateway_daemon_stopped'), 'stop should write gateway_daemon_stopped')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('gateway core smoke passed')

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
