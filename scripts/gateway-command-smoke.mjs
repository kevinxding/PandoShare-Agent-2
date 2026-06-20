#!/usr/bin/env node
import { mkdir, rm } from 'node:fs/promises'
import { resolve, relative } from 'node:path'

const core = await import('../dist/src/core/index.js')
const root = process.cwd()
const smokeRoot = resolve(root, '.tmp-gateway-command-smoke')
assertInside(root, smokeRoot)
await rm(smokeRoot, { recursive: true, force: true })
await mkdir(smokeRoot, { recursive: true })

try {
  const router = new core.GatewayCommandRouter('default')
  const route = text => router.route({ inboundId: `inbound_${Math.random().toString(36).slice(2)}`, dedupeKey: `d_${Math.random()}`, channelId: 'local', channelKind: 'local', userId: 'local-user', text, createdAtMs: Date.now(), receivedAtMs: Date.now() })
  assert(route('/goal build it').command.commandType === 'loop.create', '/goal should route to loop.create')
  assert(route('/resume loop_1').command.commandType === 'loop.resume', '/resume should route to loop.resume')
  assert(route('/approve approval_1').command.commandType === 'approval.resolve', '/approve should route to approval.resolve')
  assert(route('/gui approve gui_1').command.commandType === 'gui.approve', '/gui approve should route to gui.approve')
    assert(route('/model').command.commandType === 'gateway.model.status', '/model should route to model status')
  assert(route('/model list').command.commandType === 'gateway.model.list', '/model list should route to model list')
  assert(route('/model route code').command.commandType === 'gateway.model.route', '/model route should route to model route')
  assert(route('/model set build cheap/cheap-model').command.commandType === 'gateway.model.set', '/model set should route to model set')
  assert(route('/model health').command.commandType === 'gateway.model.health', '/model health should route to model health')
  assert(route('/model usage').command.commandType === 'gateway.model.usage', '/model usage should route to model usage')
  assert(route('/model budget').command.commandType === 'gateway.model.budget', '/model budget should route to model budget')
  assert(route('/help').replyText?.includes('/goal'), '/help should return help text')
  const unknown = route('/unknown x')
  assert(unknown.command.commandType === 'gateway.command.unknown', 'unknown slash command should be explicit')
  assert(unknown.replyText?.includes('Unknown gateway command'), 'unknown command should have reply text')
  assert(route('plain task').command.commandType === 'agent.run', 'plain text should route to agent.run')
} finally {
  assertInside(root, smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true })
}

console.log('gateway command smoke passed')

function assertInside(rootPath, targetPath) {
  const rel = relative(rootPath, targetPath)
  if (rel.startsWith('..') || rel === '' || resolve(rootPath, rel) !== targetPath) throw new Error(`Refusing to use path outside workspace: ${targetPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
